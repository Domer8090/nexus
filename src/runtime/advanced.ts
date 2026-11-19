import { run } from "./proc";
import { redact } from "./redact";
import { runningPids } from "./sessions";
import type { Session } from "@/lib/types";

/**
 * Facts for the Advanced workspace, read from the machine, never estimated:
 * the process tree under each running agent (from `ps`), and the command that resumes a
 * session in your own terminal (each agent's documented resume flag).
 */

export type ProcRow = { pid: number; ppid: number; cpu: number; rssMb: number; elapsed: string; args: string; depth: number };

export async function processTrees(): Promise<Record<string, ProcRow[]>> {
  const pids = runningPids();
  if (!Object.keys(pids).length || process.platform === "win32") return {};
  const r = await run("ps", ["-axo", "pid=,ppid=,pcpu=,rss=,etime=,args="], { timeoutMs: 5000 });
  if (r.code !== 0) return {};
  const rows = r.stdout
    .split("\n")
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ pid: +m[1], ppid: +m[2], cpu: +m[3], rssMb: Math.round(+m[4] / 1024), elapsed: m[5], args: m[6] }));
  const kids = new Map<number, typeof rows>();
  for (const row of rows) kids.set(row.ppid, [...(kids.get(row.ppid) ?? []), row]);
  const out: Record<string, ProcRow[]> = {};
  for (const [sid, pid] of Object.entries(pids)) {
    const root = rows.find((x) => x.pid === pid);
    if (!root) continue;
    const list: ProcRow[] = [];
    const walk = (p: (typeof rows)[number], depth: number) => {
      if (list.length >= 40) return;
      // Long prompts are passed as arguments; show the start only, with secrets removed.
      list.push({ ...p, depth, args: redact(p.args.length > 220 ? `${p.args.slice(0, 217)}…` : p.args) });
      for (const k of kids.get(p.pid) ?? []) walk(k, depth + 1);
    };
    walk(root, 0);
    out[sid] = list;
  }
  return out;
}

const q = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** Command that continues this session in your own terminal, or null when the agent has none. */
export function resumeCommand(s: Session): string | null {
  if (!s.nativeSessionId) return null;
  if (s.agentId === "claude-code") return `cd ${q(s.cwd)} && claude --resume ${q(s.nativeSessionId)}`;
  if (s.agentId === "codex") return `cd ${q(s.cwd)} && codex resume ${q(s.nativeSessionId)}`;
  return null;
}
