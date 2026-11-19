import crypto from "node:crypto";
import type { FileDiff } from "./workspace";
import { localJson, localModels, pickLight } from "./intake";

/**
 * Scope guard and change summary for one session's diff.
 *
 * Rules (always): deleted files, dependency and settings files, very large edits, and, when the
 * task names files or folders, files outside them. These are facts about the diff, not a verdict.
 *
 * Local model (optional, Ollama): one line per file saying what changed, and whether the change
 * looks related to the task. Labelled as the model's opinion and never unchecks a file by itself,
 * because small local models misjudge this often. Nothing leaves the machine.
 */

export type ScopeFlag = { kind: "deleted" | "dependencies" | "settings" | "large" | "removes" | "outside" | "unrelated"; text: string };
export type ReviewFile = FileDiff & { flags: ScopeFlag[]; summary?: string; related?: "yes" | "no" | "unsure" };
export type Review = { files: ReviewFile[]; engine: { kind: "rules" } | { kind: "local-model"; model: string }; note?: string };

const DEPS = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|Pipfile(\.lock)?|Cargo\.(toml|lock)|go\.(mod|sum)|Gemfile(\.lock)?|composer\.(json|lock)|Podfile(\.lock)?)$/;
const SETTINGS = /(^|\/)(\.env[^/]*|\.github\/.*|\.gitlab-ci\.yml|Dockerfile|docker-compose[^/]*|tsconfig[^/]*\.json|[^/]*\.config\.(js|cjs|mjs|ts)|\.eslintrc[^/]*|\.prettierrc[^/]*|\.gitignore|vercel\.json|netlify\.toml|Makefile)$/;
const BIG = 300;

/** Paths and folder names the task mentions, e.g. "src/app/page.tsx", "components/", "index.html". */
export function mentionedPaths(task: string): string[] {
  const out = new Set<string>();
  for (const m of task.matchAll(/(?:^|[\s"'`(])((?:[\w.-]+\/)+[\w.-]*|[\w-]+\.(?:[a-z]{1,5}))(?=$|[\s"'`),.:;])/gim)) {
    const p = m[1].replace(/^\.\//, "").replace(/[.,:;]+$/, "");
    // Skip version numbers and domains that look like file names.
    if (/^\d+(\.\d+)+$/.test(p) || /^(www\.|https?)/.test(p) || /\.(com|org|net|io|dev|app|ai|sh)$/.test(p)) continue;
    out.add(p.toLowerCase());
  }
  return [...out];
}

function inScope(file: string, mentions: string[]) {
  const f = file.toLowerCase();
  const base = f.split("/").pop()!;
  return mentions.some((m) => {
    if (m.endsWith("/")) return f.startsWith(m) || f.includes(`/${m}`);
    if (m.includes("/")) {
      const dir = m.slice(0, m.lastIndexOf("/") + 1);
      return f === m || f.endsWith(`/${m}`) || f.startsWith(dir);
    }
    return base === m;
  });
}

export function scopeFlags(task: string, files: FileDiff[]): ReviewFile[] {
  const mentions = mentionedPaths(task);
  return files.map((f) => {
    const flags: ScopeFlag[] = [];
    if (f.status === "deleted") flags.push({ kind: "deleted", text: "Deletes this file" });
    if (DEPS.test(f.path)) flags.push({ kind: "dependencies", text: "Changes dependencies" });
    else if (SETTINGS.test(f.path)) flags.push({ kind: "settings", text: "Changes project settings" });
    const lines = f.additions + f.deletions;
    if (lines >= BIG) flags.push({ kind: "large", text: `Large edit, ${lines} lines` });
    else if (f.status === "modified" && f.deletions >= 60 && f.deletions > f.additions * 2) flags.push({ kind: "removes", text: `Removes ${f.deletions} lines` });
    if (mentions.length && !inScope(f.path, mentions)) flags.push({ kind: "outside", text: "Not in the files the task names" });
    return { ...f, flags };
  });
}

/** Splits a unified diff into per-file text. */
export function splitPatch(patch: string): Map<string, string> {
  const out = new Map<string, string>();
  let cur: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur) out.set(cur, buf.join("\n"));
  };
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      cur = line.split(" b/").pop() ?? null;
      buf = [];
    }
    buf.push(line);
  }
  flush();
  return out;
}

const SCHEMA = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, summary: { type: "string" }, related: { type: "string", enum: ["yes", "no", "unsure"] } },
        required: ["path", "summary", "related"],
      },
    },
  },
  required: ["files"],
};

const cache = new Map<string, Review>();

/** Adds the local model's one-line summaries and relatedness. Falls back to rules with a note. */
export async function summarize(task: string, files: ReviewFile[], patch: string): Promise<Review> {
  const key = crypto.createHash("sha1").update(task).update(patch).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;
  const models = await localModels();
  const model = models?.length ? pickLight(models) : null;
  if (!model) return { files, engine: { kind: "rules" }, note: "Ollama isn't running, so there are no summaries. The checks above come from the diff itself." };
  const parts = splitPatch(patch);
  const budget = Math.max(600, Math.floor(9_000 / Math.max(1, files.length)));
  const body = files
    .slice(0, 40)
    .map((f) => `### ${f.path} (${f.status}, +${f.additions} -${f.deletions})\n${f.binary ? "(binary file)" : (parts.get(f.path) ?? "").split("\n").filter((l) => !l.startsWith("index ")).join("\n").slice(0, budget)}`)
    .join("\n\n");
  try {
    const out = await localJson<{ files: { path: string; summary: string; related: "yes" | "no" | "unsure" }[] }>(
      model,
      "You review a coding agent's changes for a person. For every file, write one short plain sentence about the change itself, starting with a verb (Adds, Changes, Removes, Renames, Fixes), naming the concrete thing changed. Don't describe what the file is and don't judge quality. Then say whether the change serves the task: yes, no, or unsure. A broad task (\"improve the app\") makes most changes yes. Say no only when the change is clearly about something else. Never invent files.",
      `Task:\n"""${task.slice(0, 3000)}"""\n\nChanged files:\n\n${body}`,
      SCHEMA,
      120_000,
    );
    const by = new Map(out.files.map((f) => [f.path, f]));
    const merged = files.map((f) => {
      const m = by.get(f.path);
      if (!m) return f;
      const flags = m.related === "no" && !f.flags.some((x) => x.kind === "outside") ? [...f.flags, { kind: "unrelated" as const, text: `${model} thinks this may be off-task` }] : f.flags;
      return { ...f, flags, summary: m.summary.slice(0, 240), related: m.related };
    });
    const r: Review = { files: merged, engine: { kind: "local-model", model } };
    cache.set(key, r);
    if (cache.size > 50) cache.delete(cache.keys().next().value!);
    return r;
  } catch (e) {
    return { files, engine: { kind: "rules" }, note: `The local model didn't answer (${(e as Error).message}). The checks above come from the diff itself.` };
  }
}
