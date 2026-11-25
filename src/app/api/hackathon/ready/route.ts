import fs from "node:fs";
import path from "node:path";
import { connection } from "next/server";
import { z } from "zod";
import { bad, body } from "@/lib/api";
import { hasVideo, spokenWords, youLines, type ReadyItem } from "@/lib/ready";
import { audit } from "@/runtime/audit";
import { stageAll } from "@/runtime/checkpoints";
import { viewInfo } from "@/runtime/preview-server";
import { run } from "@/runtime/proc";
import { redactPatch, secretsIn } from "@/runtime/ready-scan";
import { listSessions } from "@/runtime/sessions";
import { getSettings } from "@/runtime/settings";
import { getProject } from "@/runtime/workspace";

function current() {
  const h = getSettings().hackathon;
  const project = h?.projectId ? getProject(h.projectId) : null;
  return h && project ? { h, dir: project.path } : null;
}

const read = (dir: string, f: string) => {
  try {
    const real = fs.realpathSync(path.join(dir, f));
    return real.startsWith(fs.realpathSync(dir) + path.sep) ? fs.readFileSync(real, "utf8").slice(0, 100_000) : null;
  } catch {
    return null;
  }
};

/** What was made with AI, from the runs Nexus recorded. Facts for a disclosure the team writes. */
function aiLog(workflowId: string | null) {
  if (!workflowId) return [];
  return listSessions({ workflowId })
    .filter((s) => s.startedAt)
    .sort((a, b) => a.startedAt!.localeCompare(b.startedAt!))
    .map((s) => `- ${s.startedAt!.slice(0, 16).replace("T", " ")} UTC: ${s.title}, by ${s.agentId}${s.model ? ` (${s.model})` : ""}, ${s.status}`);
}

export async function GET() {
  await connection();
  const c = current();
  if (!c) return bad("No hackathon project.", 404);
  const { h, dir } = c;
  const [readme, sub, demo, checks] = ["README.md", "docs/SUBMISSION.md", "docs/DEMO.md", "docs/CHECKS.md"].map((f) => read(dir, f));
  const [remote, count, dirty] = await Promise.all([
    run("git", ["remote", "get-url", "origin"], { cwd: dir, timeoutMs: 5000 }),
    run("git", ["rev-list", "--count", "HEAD"], { cwd: dir, timeoutMs: 5000 }),
    run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, timeoutMs: 8000 }),
  ]);
  const commits = Number(count.stdout.trim()) || 0;
  const unsaved = dirty.stdout.split("\n").filter((l) => l && !/NEXUS_MAP\.md$/.test(l)).length;
  const you = youLines(readme, sub, demo, read(dir, "docs/JUDGE_QA.md"));
  const words = spokenWords(demo ?? "");
  const secrets = await secretsIn(dir);
  const v = viewInfo(dir);
  const items: ReadyItem[] = [
    { id: "opens", label: "There is something to open", ok: !!(v.entry || v.devCommand), fix: "Ask the agent for a page that opens, or a dev command." },
    { id: "readme", label: "README says how to run it", ok: !!readme && /\b(run|open|start|install)\b/i.test(readme), fix: "Ask the agent to write README.md with exact run steps." },
    { id: "checks", label: "Someone wrote down what was tested", ok: !!checks && checks.length > 80, fix: "Run Test and fix, or write docs/CHECKS.md." },
    { id: "you", label: you ? `${you} answers only you can write` : "Your own answers are filled in", ok: !!sub && you === 0, fix: "Edit Submission and replace each line that starts with YOU." },
    { id: "ai", label: "AI use is disclosed", ok: /\bAI\b/i.test(sub ?? "") && /\b(used|wrote|generated|disclos|assist)/i.test(sub ?? ""), fix: "Add how you used AI. The record below has the facts." },
    { id: "video", label: "Demo video link", ok: hasVideo(`${sub ?? ""}\n${readme ?? ""}`), fix: "Record it, then paste the YouTube, Vimeo or Loom link into Submission." },
    { id: "script", label: words ? `Demo script is about ${Math.max(1, Math.round((words / 150) * 10) / 10)} min spoken` : "Demo script", ok: words > 40 && words <= 320, fix: words > 320 ? "Cut the script: most events cap video at 2 to 3 minutes." : "Ask the agent for a two-minute script." },
    { id: "secrets", label: secrets.length ? `Looks like a secret in ${secrets[0]}` : "No secrets found by pattern", ok: !secrets.length, fix: "Remove it before you publish the code." },
    { id: "history", label: `${commits} commit${commits === 1 ? "" : "s"}${unsaved ? `, ${unsaved} files not committed` : ""}`, ok: commits > 2 && unsaved === 0, fix: "Commit as you go. A single commit can look like finished work brought in." },
    { id: "remote", label: "Code has a remote repository", ok: remote.code === 0, fix: "Create a repository on GitHub and add it as origin. Check that judges can open it." },
  ];
  return Response.json({ items, unsaved, log: [`# AI use in ${h.name}`, "", "Recorded by Nexus. Write your own disclosure from it.", "", ...aiLog(h.workflowId)].join("\n") });
}

const schema = z.object({ action: z.literal("commit"), message: z.string().trim().min(3, "Say what changed.").max(120), confirm: z.literal(true) });

/** One local commit, made by the person's click and with their own git identity. Never pushed. */
export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid request.");
  const c = current();
  if (!c) return bad("No hackathon project.", 404);
  if (listSessions({ workflowId: c.h.workflowId ?? undefined }).some((s) => ["running", "starting"].includes(s.status))) return bad("Wait until the agents finish this step, so a half-done change isn't committed.");
  if ((await secretsIn(c.dir)).length) return bad("Something looks like a secret. Remove it first.");
  try {
    await stageAll(c.dir);
  } catch (e) {
    return bad(redactPatch((e as Error).message));
  }
  const r = await run("git", ["commit", "-q", "-m", p.data.message], { cwd: c.dir, timeoutMs: 60_000 });
  if (r.code !== 0) return bad(redactPatch((r.stderr || r.stdout).trim().slice(0, 300)) || "Nothing to commit.");
  audit("hackathon.commit", c.dir);
  return Response.json({ ok: true });
}
