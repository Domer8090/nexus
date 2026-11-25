import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import type { AgentEvent } from "@/lib/types";
import type { Proof, ProofItem } from "@/lib/proof-types";
import { isTestCommand } from "@/lib/test-command";
import { run } from "./proc";
import { redact } from "./redact";
import { splitPatch } from "./review";

/**
 * Proof checks: does the diff back up what the agent said? Pattern checks on the diff and on the
 * commands Nexus recorded. They are facts to look at, not a verdict on correctness. No model.
 */

const SECRET: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, "AWS access key"],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/, "API key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\b[sr]k_live_[A-Za-z0-9]{16,}/, "Stripe live key"],
  [/(?:api[_-]?key|secret|token|passw(?:or)?d)["']?\s*[:=]\s*["'](?!\s*(?:your|example|test|xxx|changeme|placeholder|<))[A-Za-z0-9+/_=-]{20,}["']/i, "hard-coded credential"],
];
const SENSITIVE_FILE = /(^|\/)(\.env(?!\.example)[^/]*|[^/]*\.(pem|key|p12|pfx|keystore)|id_(rsa|ed25519|ecdsa)[^/]*|\.npmrc|\.netrc|credentials[^/]*)$/i;
const TEST_FILE = /(^|\/)(__tests__|tests?|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/i;
const CODE_FILE = /\.(m?[jt]sx?|cjs|py|go|rs|rb|java|kt|swift|php|cs|vue|svelte)$/i;
const JS_FILE = /\.(m?[jt]sx?|cjs|mts|cts|vue|svelte)$/i;
const ASSERT = /\b(expect|assert\w*|should)\s*[.(]|^\s*assert\s/;

export type AddedLine = { n: number; text: string };

/** Added and removed lines of one file's unified diff, with new-file line numbers. */
export function diffLines(chunk: string): { added: AddedLine[]; removed: string[] } {
  const added: AddedLine[] = [];
  const removed: string[] = [];
  let n = 0;
  let inHunk = false;
  for (const l of chunk.split("\n")) {
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (h) {
      n = Number(h[1]);
      inHunk = true;
    } else if (!inHunk) continue;
    else if (l.startsWith("+")) added.push({ n: n++, text: l.slice(1) });
    else if (l.startsWith("-")) removed.push(l.slice(1));
    else if (l.startsWith(" ")) n++;
  }
  return { added, removed };
}

export const isSensitivePath = (p: string) => SENSITIVE_FILE.test(p);

export const looksSecret = (line: string) => SECRET.some(([re]) => re.test(line));

/** Hides anything that looks like a secret. Used before a diff leaves Nexus in a file or an API call. */
export function maskSecrets(text: string): string {
  const keyBlock = text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[hidden private key]");
  return redact(
    keyBlock
      .split("\n")
      .map((l) => (SECRET.some(([re]) => re.test(l)) ? `${/^[+-]/.test(l) ? l[0] : ""}[line hidden: looks like a secret]` : l))
      .join("\n"),
  );
}

export function patchFindings(patch: string): ProofItem[] {
  const out: ProofItem[] = [];
  for (const [file, chunk] of splitPatch(patch)) {
    const { added, removed } = diffLines(chunk);
    const isTest = TEST_FILE.test(file);
    for (const a of added) {
      const s = SECRET.find(([re]) => re.test(a.text));
      if (s) out.push({ kind: "secret", level: "bad", file, line: a.n, text: `Looks like a ${s[1]}` });
    }
    if (isSensitivePath(file) && added.length) out.push({ kind: "secret", level: "bad", file, text: "A file that usually holds secrets" });
    if (!CODE_FILE.test(file)) continue;
    if (isTest) {
      if (/^deleted file mode/m.test(chunk)) {
        out.push({ kind: "test-weakened", level: "bad", file, text: "Deletes a test file" });
        continue;
      }
      const skip = added.find((a) => /\b(?:it|test|describe)\.(?:skip|only|todo)\b|\bx(?:it|describe)\s*\(|@pytest\.mark\.(?:skip|xfail)|@unittest\.skip|t\.Skip\(|#\[ignore\]/.test(a.text));
      if (skip) out.push({ kind: "test-weakened", level: "bad", file, line: skip.n, text: "Skips or limits tests" });
      const empty = added.find((a) => /expect\(\s*(true|1)\s*\)\.(?:toBe|toEqual)\(\s*\1\s*\)|\bassert\s+True\b|assert\(\s*true\s*\)/.test(a.text));
      if (empty) out.push({ kind: "test-weakened", level: "bad", file, line: empty.n, text: "Adds a test that always passes" });
      const lost = removed.filter((l) => ASSERT.test(l)).length - added.filter((a) => ASSERT.test(a.text)).length;
      if (lost > 0) out.push({ kind: "test-weakened", level: "warn", file, text: `Removes ${lost} more check${lost === 1 ? "" : "s"} than it adds` });
      continue;
    }
    const first = (re: RegExp) => added.find((a) => re.test(a.text));
    const stub = first(/(?:\/\/|#|\/\*|<!--)\s*(?:TODO|FIXME|HACK|XXX)\b|not (?:yet )?implemented|NotImplementedError|\bunimplemented!\(|\btodo!\(|rest of (?:the )?(?:code|implementation)/i);
    if (stub) out.push({ kind: "stub", level: "warn", file, line: stub.n, text: "Leaves unfinished code" });
    const hush = first(/@ts-(?:ignore|nocheck)|eslint-disable|#\s*(?:type:\s*ignore|noqa)|#\[allow\(|catch\s*(?:\([^)]*\))?\s*\{\s*\}|except[^:]*:\s*pass\b/);
    if (hush) out.push({ kind: "suppressed", level: "warn", file, line: hush.n, text: "Hides an error instead of fixing it" });
  }
  return out;
}

type Ev = Pick<AgentEvent, "kind" | "text" | "data">;

/** Compares what the agent said about tests with the commands Nexus saw it run. */
export function claimFindings(events: Ev[]): { items: ProofItem[]; evidence: string[] } {
  const said = events.filter((e) => e.kind === "text").map((e) => e.text).join("");
  const claims = said
    .split(/(?<=[.!?])\s+|\n+/)
    .some((s) => /\b(?:tests?|suite|specs?)\b[^.!?\n]{0,40}\b(?:pass(?:es|ed|ing)?|green|succeed(?:s|ed)?)\b|\b\d+\s+(?:tests?\s+)?passed\b/i.test(s) && !/\b(?:should|would|will|if|once|until|when|can't|cannot|couldn't|could not|didn't|did not|haven't|have not|not|unable|make sure|ensure|fail(?:ed|s|ing)?)\b/i.test(s));
  const isShell = (e: Ev) => e.kind === "tool" && /^(?:Bash|Shell)\b/.test(e.text);
  let last = -1;
  events.forEach((e, i) => {
    const ran = isShell(e) && (typeof e.data?.test === "boolean" ? e.data.test : isTestCommand(e.text.replace(/^\w+: /, "")));
    if (ran || (e.kind === "system" && /^Check npm run test(?::\S+)? (?:passed|failed)/.test(e.text))) last = i;
  });
  const items: ProofItem[] = [];
  const evidence: string[] = [];
  if (last < 0) {
    // Runs recorded before Nexus kept this fact only have shortened commands, so the test may be in the cut part.
    const cut = events.some((e) => isShell(e) && typeof e.data?.test !== "boolean" && e.text.endsWith("…"));
    const own = events.some((e) => isShell(e) && /test/i.test(e.text));
    if (claims) items.push(cut || own ? { kind: "claim", level: "warn", text: "The agent says tests pass. Nexus couldn't confirm it from the commands it recorded" } : { kind: "claim", level: "bad", text: "The agent says tests pass, but Nexus saw no test command run" });
    return { items, evidence };
  }
  const after = events.slice(last + 1);
  const id = events[last].data?.id;
  const next = after.findIndex((e) => e.kind === "tool" || e.kind === "system");
  const failed = /^Check .* failed$/.test(events[last].text) || (typeof id === "string" ? after.some((e) => e.kind === "tool-result" && e.data?.id === id) : (next < 0 ? after : after.slice(0, next)).some((e) => e.kind === "tool-result"));
  evidence.push(events[last].text.slice(0, 160));
  if (failed) items.push({ kind: "claim", level: claims ? "bad" : "warn", text: claims ? "The agent says tests pass, but the last test run reported an error" : "The last test run reported an error" });
  if (after.some((e) => e.kind === "file")) items.push({ kind: "claim", level: "warn", text: "Files changed after the last test run, so that result is out of date" });
  return { items, evidence };
}

const DEP_KEYS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
type Pkg = { name?: string; imports?: object } & Partial<Record<(typeof DEP_KEYS)[number], Record<string, string>>>;
const deps = (p: Pkg) => DEP_KEYS.flatMap((k) => Object.keys(p[k] ?? {}));

function readPkg(file: string): Pkg | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Pkg;
  } catch {
    return null;
  }
}

/** The package an import comes from, or null for relative paths, aliases and Node's own modules. */
export function packageOf(spec: string): string | null {
  if (/^[./#~]|^@\/|^[a-z]+:|[\s$`]/i.test(spec)) return null;
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (builtinModules.includes(parts[0])) return null;
  return /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name) && (!spec.startsWith("@") || parts.length > 1) ? name : null;
}

function aliases(dir: string): string[] {
  for (const f of ["tsconfig.json", "jsconfig.json"]) {
    try {
      const raw = fs.readFileSync(path.join(dir, f), "utf8");
      const block = raw.match(/"paths"\s*:\s*\{([\s\S]*?)\}/)?.[1] ?? "";
      return [...block.matchAll(/"([^"]+)"\s*:/g)].map((m) => m[1].replace(/\*$/, ""));
    } catch {}
  }
  return [];
}

async function packageFindings(cwd: string, base: string | null, patch: string): Promise<{ items: ProofItem[]; added: string[] }> {
  const items: ProofItem[] = [];
  const added = new Set<string>();
  const root = readPkg(path.join(cwd, "package.json"));
  for (const [file, chunk] of splitPatch(patch)) {
    if (/(^|\/)package\.json$/.test(file)) {
      const now = readPkg(path.join(cwd, file));
      const old = await run("git", ["show", `${base ?? "HEAD"}:${file}`], { cwd, timeoutMs: 8000 });
      let before: Pkg = {};
      try {
        if (old.code === 0) before = JSON.parse(old.stdout) as Pkg;
      } catch {}
      const had = new Set(deps(before));
      if (now) for (const d of deps(now)) if (!had.has(d)) added.add(d);
    }
    if (!root || !JS_FILE.test(file)) continue;
    const known = new Set(deps(root));
    const alias = aliases(cwd);
    let dir = path.dirname(file);
    while (dir !== "." && dir !== "/") {
      const p = readPkg(path.join(cwd, dir, "package.json"));
      if (p) {
        deps(p).forEach((d) => known.add(d));
        if (p.name) known.add(p.name);
      }
      alias.push(...aliases(path.join(cwd, dir)));
      dir = path.dirname(dir);
    }
    if (root.name) known.add(root.name);
    for (const a of diffLines(chunk).added) {
      const spec = a.text.match(/^\s*(?:import|export)\b[^"']*["']([^"']+)["']|\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/);
      const s = spec?.[1] ?? spec?.[2];
      if (!s || alias.some((x) => s.startsWith(x))) continue;
      const name = packageOf(s);
      if (!name || known.has(name) || known.has(`@types/${name}`) || fs.existsSync(path.join(cwd, "node_modules", name))) continue;
      if (!items.some((i) => i.text.includes(` ${name},`))) items.push({ kind: "package", level: "bad", file, line: a.n, text: `Uses ${name}, which is not in package.json` });
    }
  }
  return { items, added: [...added] };
}

/** Looks new dependencies up on the public npm registry. Only runs when the person asks. */
export async function npmFindings(names: string[]): Promise<ProofItem[]> {
  return (
    await Promise.all(
      names.slice(0, 20).map(async (n): Promise<ProofItem | null> => {
        const item = (level: "bad" | "warn", text: string): ProofItem => ({ kind: "package", level, text });
        try {
          const r = await fetch(`https://registry.npmjs.org/${n.replace("/", "%2f")}`, { signal: AbortSignal.timeout(12_000) });
          if (r.status === 404) return item("bad", `${n} does not exist on the public npm registry`);
          if (!r.ok) return item("warn", `npm did not answer for ${n} (${r.status})`);
          const created = ((await r.json()) as { time?: { created?: string } }).time?.created;
          const days = created ? Math.floor((Date.now() - Date.parse(created)) / 86_400_000) : null;
          return days != null && days < 30 ? item("warn", `${n} is only ${days} day${days === 1 ? "" : "s"} old on npm`) : null;
        } catch {
          return item("warn", `Couldn't reach npm to check ${n}`);
        }
      }),
    )
  ).filter((x): x is ProofItem => !!x);
}

export async function proofFor(input: { cwd: string; base: string | null; patch: string; truncated: boolean; events: AgentEvent[] }): Promise<Proof> {
  const c = claimFindings(input.events);
  const p = await packageFindings(input.cwd, input.base, input.patch);
  const items = [...c.items, ...patchFindings(input.patch), ...p.items].sort((a, b) => Number(a.level === "warn") - Number(b.level === "warn"));
  return { items, evidence: c.evidence, newPackages: p.added, truncated: input.truncated };
}
