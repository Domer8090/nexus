import type { Session, UsageMetrics } from "@/lib/types";
import { codexRateLimits } from "./agents/codex-limits";
import { getDb } from "./db";

/**
 * How close each account agent is to its usage limits, from what the agents themselves reported:
 * Claude Code's rate_limit_event in the newest Nexus run, and Codex's own session log. No guesses:
 * an agent with nothing reported has no entry. Windows whose reset time has passed are dropped.
 */

export type LimitLevel = "ok" | "near" | "out";
export type AgentLimits = {
  agentId: string;
  agentName: string;
  windows: NonNullable<UsageMetrics["quota"]>;
  level: LimitLevel;
  /** The fullest window, for one-line warnings. */
  top: NonNullable<UsageMetrics["quota"]>[number];
  at: string | null;
  source: string;
};

export const NEAR = 0.8;

export function levelOf(windows: NonNullable<UsageMetrics["quota"]>): LimitLevel {
  if (windows.some((w) => w.utilization >= 1 || w.status === "rejected")) return "out";
  if (windows.some((w) => w.utilization >= NEAR || w.status === "allowed_warning")) return "near";
  return "ok";
}

function live(windows: NonNullable<UsageMetrics["quota"]>, now: number) {
  return windows.filter((w) => !w.resetsAt || Date.parse(w.resetsAt) > now);
}

const NUM: Record<string, string> = { one: "1", five: "5", seven: "7", thirty: "30" };
/** Claude Code says "seven_day", Codex windows come in minutes: show both as "7-day". */
export const tidyWindow = (w: string) => w.replace(/_/g, "-").replace(/^(one|five|seven|thirty)(?=-)/, (m) => NUM[m]);

function entry(agentId: string, agentName: string, windows: NonNullable<UsageMetrics["quota"]>, at: string | null, source: string): AgentLimits | null {
  const w = live(windows, Date.now()).map((x) => ({ ...x, window: tidyWindow(x.window) }));
  if (!w.length) return null;
  const top = [...w].sort((a, b) => b.utilization - a.utilization)[0];
  return { agentId, agentName, windows: w, level: levelOf(w), top, at, source };
}

function lastClaude(): AgentLimits | null {
  const rows = getDb().prepare("SELECT data FROM sessions ORDER BY created_at DESC LIMIT 300").all() as { data: string }[];
  for (const r of rows) {
    const s = JSON.parse(r.data) as Session;
    if (s.agentId === "claude-code" && s.usage?.quota?.length) return entry("claude-code", "Claude Code", s.usage.quota, s.endedAt ?? s.startedAt, "Claude Code's rate limit report in the newest Nexus run");
  }
  return null;
}

let cache: { at: number; value: AgentLimits[] } | null = null;

export function agentLimits(fresh = false): AgentLimits[] {
  if (!fresh && cache && Date.now() - cache.at < 15_000) return cache.value;
  const out: AgentLimits[] = [];
  const c = lastClaude();
  if (c) out.push(c);
  const x = codexRateLimits();
  if (x) {
    const e = entry("codex", "Codex", x.quota, x.at, "Codex's own session log (~/.codex/sessions)");
    if (e) out.push(e);
  }
  cache = { at: Date.now(), value: out };
  return out;
}

export function limitsFor(agentId: string): AgentLimits | null {
  return agentLimits().find((l) => l.agentId === agentId) ?? null;
}

/** One sentence for a warning: "Codex has used 86% of its 30-day limit; it resets Dec 1, 9:38 AM." */
export function describe(l: AgentLimits): string {
  const when = l.top.resetsAt ? new Date(l.top.resetsAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  const pct = Math.round(l.top.utilization * 100);
  return `${l.agentName} has used ${pct}% of its ${l.top.window} limit${when ? `; it resets ${when}` : ""}.`;
}
