import { bad, body } from "@/lib/api";
import { getDb } from "@/runtime/db";
import { runningCount } from "@/runtime/sessions";

/** Deletes Nexus metadata (projects list, sessions, events, stacks, settings, cache). Never touches project files, worktrees, skills or agent configs. */
export async function POST(req: Request) {
  const b = await body<{ confirm?: string }>(req);
  if (b?.confirm !== "RESET") return bad("Type RESET to confirm.");
  if (runningCount() > 0) return bad("Stop running sessions first.");
  getDb().exec("DELETE FROM events; DELETE FROM sessions; DELETE FROM workflows; DELETE FROM projects; DELETE FROM cache; DELETE FROM kv; DELETE FROM skill_installs; DELETE FROM audit;");
  return Response.json({ ok: true });
}
