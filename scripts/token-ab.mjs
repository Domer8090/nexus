// Run with the Nexus dev server on 127.0.0.1:3000:
//   REPO=~/code/app PROJECT=prj_xxx node scripts/token-ab.mjs
// It runs the same task with plain `claude -p` and through Nexus and prints tokens per run.
// Token A/B: the same task run with plain `claude -p` and through Nexus, same model, same start commit.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TASK = "Add a footer to index.html with the text \"Made by the Science Club\". Match the page's existing style.";
const MODEL = "sonnet";
const REPO = process.env.REPO; // the project folder Nexus knows
const PROJECT = process.env.PROJECT; // its Nexus project id
if (!REPO || !PROJECT) throw new Error("Set REPO and PROJECT.");
const BASE = "http://127.0.0.1:3000";
const H = { "content-type": "application/json", Origin: BASE };
const dir = process.env.OUT ?? fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "nexus-ab-"));
const total = (u) => (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0) + (u.output ?? 0);

function plain(n) {
  const cwd = path.join(dir, `plain-${n}`);
  fs.rmSync(cwd, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", REPO, cwd]);
  const t0 = Date.now();
  // A clean login shell, like typing the command in Terminal (no variables from this Claude Code session).
  const env = { HOME: process.env.HOME, USER: process.env.USER, LOGNAME: process.env.USER, SHELL: "/bin/zsh", TERM: "xterm-256color", PATH: process.env.PATH };
  const r = spawnSync("/bin/zsh", ["-lc", 'claude -p "$T" --output-format json --model sonnet --permission-mode acceptEdits'], { cwd, env: { ...env, T: TASK }, encoding: "utf8", timeout: 600_000 });
  const o = JSON.parse(r.stdout);
  const u = o.usage ?? {};
  const changed = execFileSync("git", ["diff", "--stat"], { cwd, encoding: "utf8" }).trim();
  return { arm: "plain claude -p (clean Terminal env)", n, ok: !o.is_error, input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, output: u.output_tokens, turns: o.num_turns, cost: o.total_cost_usd, ms: Date.now() - t0, changed };
}

async function nexus(n, concise = "normal") {
  const res = await fetch(`${BASE}/api/workflows`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      projectId: PROJECT, preset: "solo", goal: TASK, brief: TASK, skills: [], concise,
      permissions: { editFiles: true, runShell: true, network: true, isolate: true },
      tasks: [{ role: "solo", agentId: "claude-code", title: `Token test ${n}`, brief: TASK, model: MODEL }],
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j));
  const id = j.sessions[0].id;
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const s = (await (await fetch(`${BASE}/api/sessions/${id}`, { headers: H })).json()).session;
    if (["completed", "failed", "cancelled"].includes(s.status)) {
      const u = s.usage ?? {};
      let changed = "";
      try { changed = execFileSync("git", ["diff", "--stat", s.baseRef], { cwd: s.cwd, encoding: "utf8" }).trim(); } catch {}
      return { arm: `nexus (${concise})`, n, id, ok: s.status === "completed", input: u.inputTokens, cacheRead: u.cacheReadTokens, cacheWrite: u.cacheWriteTokens, output: u.outputTokens, ms: Date.now() - t0, changed, error: s.error };
    }
  }
}

const out = [];
const log = (r) => { r.total = total(r); out.push(r); console.log(JSON.stringify(r)); fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(out, null, 2)); };
log(plain(1));
log(await nexus(1));
log(await nexus(2));
log(plain(2));
log(await nexus(3, "concise"));
