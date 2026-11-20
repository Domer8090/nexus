// Usage: node scripts/token-arms.mjs <run number> <arm> [<arm>...]   e.g. node scripts/token-arms.mjs 1 plain lean-user
// Runs a task on a fresh clone of this repository per arm and prints Claude Code's own token numbers.
// Token experiment on the NEXUS repo itself (166 files, ~25k lines). Each arm runs in a fresh clone
// from a clean login-shell environment, with Claude Code's own usage numbers.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "..");
const DIR = process.env.OUT ?? fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "nexus-arms-"));
const TASK = "The usage-limit warning fires when an agent has used 80% of a window. Change that threshold to 85% everywhere it is defined or documented, and update any test that checks it.";
const NEXUS_LINE = "You are running inside Nexus. Work only inside the current directory. Do not push, deploy, or rewrite git history.";
const ENV = { HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.USER, SHELL: "/bin/zsh", TERM: "xterm-256color", PATH: process.env.PATH };

const ARMS = {
  plain: { map: null, extra: [] },
  nexus: { map: "file", extra: [] },
  inline: { map: "inline", extra: [] },
  "no-mcp": { map: "file", extra: ["--strict-mcp-config"] },
  lean: { map: "file", extra: ["--strict-mcp-config", "--disable-slash-commands"] },
  "lean-user": { map: "file", extra: ["--strict-mcp-config", "--disable-slash-commands", "--setting-sources", "project,local"] },
  "lean-nomap": { map: "none", extra: ["--strict-mcp-config", "--disable-slash-commands", "--setting-sources", "project,local"] },
  "lean-inline": { map: "inline", extra: ["--strict-mcp-config", "--disable-slash-commands", "--setting-sources", "project,local"] },
};

function runArm(name, n) {
  const arm = ARMS[name];
  const cwd = path.join(DIR, `${name}-${n}`);
  fs.rmSync(cwd, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", REPO, cwd]);
  let prompt = TASK;
  const args = ["--output-format", "stream-json", "--verbose", "--model", "sonnet", "--permission-mode", "acceptEdits"];
  if (arm.map === "none") args.push("--permission-prompts", "none", "--allowedTools", "Bash", "--append-system-prompt", NEXUS_LINE);
  else if (arm.map) {
    const m = JSON.parse(execFileSync("node", [path.join(HERE, "token-map.mjs"), cwd], { encoding: "utf8" }));
    if (arm.map === "file") prompt += `\n\n---\nContext:\n${m.instruction}`;
    else {
      const text = fs.readFileSync(path.join(cwd, "NEXUS_MAP.md"), "utf8");
      fs.rmSync(path.join(cwd, "NEXUS_MAP.md"));
      prompt += `\n\n---\nContext:\nProject map (every file with its size and the names it defines). Use it instead of listing folders; open only the files you need.\n\n${text}`;
    }
    args.push("--permission-prompts", "none", "--allowedTools", "Bash", "--append-system-prompt", NEXUS_LINE);
  }
  args.push(...arm.extra);
  const t0 = Date.now();
  const r = spawnSync("/bin/zsh", ["-lc", 'claude -p "$P" "$@"', "zsh", ...args], { cwd, env: { ...ENV, P: prompt }, encoding: "utf8", timeout: 900_000, maxBuffer: 200 * 1024 * 1024 });
  fs.writeFileSync(path.join(DIR, `${name}-${n}.jsonl`), r.stdout);
  const calls = new Map();
  let init = null, result = null;
  for (const l of r.stdout.split("\n")) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type === "system" && o.subtype === "init") init = { tools: o.tools?.length, mcp: (o.mcp_servers ?? []).filter((m) => m.status === "connected").length, skills: o.skills?.length };
    if (o.type === "assistant" && o.message?.id) calls.set(o.message.id, o.message.usage);
    if (o.type === "result") result = o;
  }
  const u = result?.usage ?? {};
  const ctx = [...calls.values()].map((x) => (x.input_tokens ?? 0) + (x.cache_read_input_tokens ?? 0) + (x.cache_creation_input_tokens ?? 0));
  const diff = execFileSync("git", ["diff", "--stat"], { cwd, encoding: "utf8" }).trim().split("\n").pop();
  const done = /NEAR = 0\.85/.test(fs.readFileSync(path.join(cwd, "src/runtime/limits.ts"), "utf8"));
  const total = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
  const row = { arm: name, n, done, total, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, output: u.output_tokens, calls: calls.size, firstCall: ctx[0], cost: result?.total_cost_usd, s: Math.round((Date.now() - t0) / 1000), init, diff, error: result?.is_error ? result.result : undefined };
  console.log(JSON.stringify(row));
  fs.appendFileSync(path.join(DIR, "results.jsonl"), JSON.stringify(row) + "\n");
  return row;
}

const [n, ...names] = process.argv.slice(2);
for (const name of names) runArm(name, Number(n));
