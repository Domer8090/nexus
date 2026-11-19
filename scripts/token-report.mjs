#!/usr/bin/env node
// Token backtest: reads the token counts the agents themselves reported for every finished step in
// ~/.nexus/nexus.db and compares like with like (same agent, same role). Nothing is estimated.
//
//   node scripts/token-report.mjs
//
// "Context" is every input token the model processed: fresh input plus cache reads and writes for
// Claude Code; Codex reports input with its cached part included. "Output" is generated tokens.
// Ollama runs on this machine and uses no account quota, so it is listed apart.
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";

const db = new DatabaseSync(path.join(process.env.NEXUS_HOME || path.join(os.homedir(), ".nexus"), "nexus.db"), { readOnly: true });
const count = db.prepare("SELECT count(*) AS c FROM events WHERE session_id = ? AND text LIKE ?");
const steps = db
  .prepare("SELECT data FROM sessions")
  .all()
  .map((r) => JSON.parse(r.data))
  .filter((s) => s.usage && s.status !== "failed")
  .map((s) => {
    const u = s.usage;
    const context = s.agentId === "claude-code" ? (u.inputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0) : u.inputTokens ?? 0;
    return { s, agent: s.agentId, model: u.model || s.model || "default", role: s.role, map: count.get(s.id, "Wrote NEXUS_MAP%").c > 0, style: s.conciseMode, context, output: u.outputTokens ?? 0, cached: s.agentId === "claude-code" ? u.cacheReadTokens ?? 0 : u.cacheReadTokens ?? 0 };
  });

const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const fmt = (n) => (n == null ? "-" : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const pct = (a, b) => (a == null || b == null || !b ? "" : `${a > b ? "+" : ""}${Math.round(((a - b) / b) * 100)}%`);
const row = (cols) => console.log(cols.map((c, i) => String(c).padEnd(i ? 13 : 32)).join(""));

console.log(`\n${steps.length} finished steps with reported token counts.\n`);

console.log("Project map on vs off, same agent, model and role (average per step)");
row(["agent / model / role", "steps off/on", "context off", "context on", "change", "output off", "output on", "change"]);
const keyOf = (x) => `${x.agent.replace("claude-code", "claude")} / ${x.model.replace("claude-", "")} / ${x.role}`;
for (const key of [...new Set(steps.filter((x) => x.agent !== "ollama").map(keyOf))]) {
  const g = steps.filter((x) => keyOf(x) === key);
  const off = g.filter((x) => !x.map);
  const on = g.filter((x) => x.map);
  if (!off.length || !on.length) continue;
  const [co, cn, oo, on2] = [avg(off.map((x) => x.context)), avg(on.map((x) => x.context)), avg(off.map((x) => x.output)), avg(on.map((x) => x.output))];
  row([key, `${off.length}/${on.length}`, fmt(co), fmt(cn), pct(cn, co), fmt(oo), fmt(on2), pct(on2, oo)]);
}

console.log("\nOutput style, Claude Code build and solo steps by model (average output tokens per step)");
for (const m of [...new Set(steps.filter((x) => x.agent === "claude-code").map((x) => x.model))])
  for (const st of ["normal", "concise", "aggressive"]) {
    const g = steps.filter((x) => x.agent === "claude-code" && x.model === m && ["build", "solo"].includes(x.role) && x.style === st);
    if (g.length) row([`${m.replace("claude-", "")} ${st}`, `${g.length} steps`, fmt(avg(g.map((x) => x.output)))]);
  }

console.log("\nWhole runs: cloud tokens per run, by how many cloud agents took part");
const runs = new Map();
for (const x of steps) if (x.s.workflowId) runs.set(x.s.workflowId, [...(runs.get(x.s.workflowId) ?? []), x]);
const bySize = new Map();
for (const g of runs.values()) {
  const cloud = g.filter((x) => x.agent !== "ollama");
  if (!cloud.length) continue;
  const k = cloud.length === 1 ? "1 cloud step" : `${cloud.length} cloud steps`;
  bySize.set(k, [...(bySize.get(k) ?? []), { context: cloud.reduce((a, x) => a + x.context, 0), output: cloud.reduce((a, x) => a + x.output, 0), local: g.length - cloud.length }]);
}
row(["run shape", "runs", "context", "output", "local steps"]);
for (const [k, g] of [...bySize].sort()) row([k, g.length, fmt(avg(g.map((x) => x.context))), fmt(avg(g.map((x) => x.output))), avg(g.map((x) => x.local))]);

const claude = steps.filter((x) => x.agent === "claude-code");
const share = claude.reduce((a, x) => a + (x.s.usage.cacheReadTokens ?? 0), 0) / Math.max(1, claude.reduce((a, x) => a + x.context, 0));
console.log(`\nClaude Code: ${Math.round(share * 100)}% of its context tokens were cache reads.`);
console.log("Ollama steps (local, no account quota):", steps.filter((x) => x.agent === "ollama").length);
console.log("\nTasks differ between runs, so small groups show tendencies, not proof. For a fair test, run the same task with a setting on and off several times.\n");
