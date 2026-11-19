import { connection } from "next/server";
import { processTrees, resumeCommand } from "@/runtime/advanced";
import { listSessions, runningPids } from "@/runtime/sessions";

/** Sessions for the Advanced workspace with their pid, process tree and resume command. */
export async function GET() {
  await connection();
  const sessions = listSessions({ limit: 80 });
  const pids = runningPids();
  const trees = await processTrees();
  return Response.json({
    sessions: sessions.map((s) => ({ ...s, pid: pids[s.id] ?? null, procs: trees[s.id] ?? [], resume: resumeCommand(s) })),
  });
}
