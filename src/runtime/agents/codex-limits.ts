import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UsageMetrics } from "@/lib/types";

/**
 * Codex's usage limits, read from Codex's own session logs. Codex writes a `rate_limits` block
 * (used percent, window length, reset time) into ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl as
 * it runs. `codex exec --json` doesn't print it, so Nexus reads the newest block from that file.
 * Nothing in it is a credential; Nexus reads only the rate_limits object.
 */

type Quota = NonNullable<UsageMetrics["quota"]>;
type Window = { used_percent?: number; window_minutes?: number; resets_at?: number };

const codexHome = () => process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");

export function windowName(minutes: number | undefined): string {
  if (!minutes) return "usage";
  if (minutes === 300) return "5-hour";
  if (minutes === 10080) return "7-day";
  if (minutes >= 43000 && minutes <= 44700) return "30-day";
  if (minutes % 1440 === 0) return `${minutes / 1440}-day`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour`;
  return `${minutes}-minute`;
}

/** Parses the last rate_limits block in a chunk of rollout JSONL. Exported for tests. */
export function parseRateLimits(text: string): { quota: Quota; at: string | null; plan: string | null } | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"rate_limits"')) continue;
    let o: { timestamp?: string; payload?: { rate_limits?: unknown }; rate_limits?: unknown };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const rl = (o.payload?.rate_limits ?? o.rate_limits) as { primary?: Window | null; secondary?: Window | null; plan_type?: string | null; rate_limit_reached_type?: string | null } | null | undefined;
    if (!rl) continue;
    const quota: Quota = [];
    for (const w of [rl.primary, rl.secondary]) {
      if (!w || typeof w.used_percent !== "number") continue;
      quota.push({
        window: windowName(w.window_minutes),
        utilization: w.used_percent / 100,
        resetsAt: typeof w.resets_at === "number" ? new Date(w.resets_at * 1000).toISOString() : undefined,
        status: rl.rate_limit_reached_type ? "rejected" : w.used_percent >= 100 ? "rejected" : "allowed",
      });
    }
    if (quota.length) return { quota, at: o.timestamp ?? null, plan: rl.plan_type ?? null };
  }
  return null;
}

/** Day folders, newest first, for the last `days` days that exist. */
function dayDirs(days: number): string[] {
  const root = path.join(codexHome(), "sessions");
  const out: string[] = [];
  for (let d = 0; d < days; d++) {
    const t = new Date(Date.now() - d * 86_400_000);
    const dir = path.join(root, String(t.getFullYear()), String(t.getMonth() + 1).padStart(2, "0"), String(t.getDate()).padStart(2, "0"));
    if (fs.existsSync(dir)) out.push(dir);
  }
  return out;
}

function tail(file: string, bytes = 512 * 1024): string {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The newest limits Codex recorded: for one thread when `threadId` is given, otherwise from the most
 * recently written session (which may be one you ran in your own terminal).
 */
export function codexRateLimits(threadId?: string | null): { quota: Quota; at: string | null; plan: string | null; file: string } | null {
  try {
    const files: { file: string; mtime: number }[] = [];
    for (const dir of dayDirs(threadId ? 3 : 31)) {
      for (const f of fs.readdirSync(dir)) {
        if (!f.startsWith("rollout-") || !f.endsWith(".jsonl")) continue;
        if (threadId && !f.endsWith(`${threadId}.jsonl`)) continue;
        const file = path.join(dir, f);
        files.push({ file, mtime: fs.statSync(file).mtimeMs });
      }
      if (threadId && files.length) break;
    }
    files.sort((a, b) => b.mtime - a.mtime);
    for (const { file } of files.slice(0, 8)) {
      const r = parseRateLimits(tail(file));
      if (r) return { ...r, file };
    }
  } catch {}
  return null;
}
