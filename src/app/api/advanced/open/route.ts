import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { run } from "@/runtime/proc";
import { getSession } from "@/runtime/sessions";

const schema = z.object({ sessionId: z.string().min(1).max(64) });

/** Opens macOS Terminal in a session's folder (its worktree), so you can take over by hand. */
export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad("Invalid request.");
  const s = getSession(p.data.sessionId);
  if (!s) return bad("Session not found.", 404);
  if (process.platform !== "darwin") return bad(`Open a terminal yourself in ${s.cwd}`);
  const r = await run("open", ["-a", "Terminal", s.cwd], { timeoutMs: 5000 });
  if (r.code !== 0) return bad("Could not open Terminal.");
  audit("advanced.terminal", s.cwd);
  return Response.json({ ok: true });
}
