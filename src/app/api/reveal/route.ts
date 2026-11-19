import { z } from "zod";
import { bad, body } from "@/lib/api";
import { run } from "@/runtime/proc";
import { getSession } from "@/runtime/sessions";
import { getProject } from "@/runtime/workspace";

const schema = z.object({ sessionId: z.string().optional(), projectId: z.string().optional() });

/** Shows a session's folder (or the project) in Finder. Only folders Nexus already tracks. */
export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad("Invalid request.");
  const dir = p.data.sessionId ? getSession(p.data.sessionId)?.cwd : p.data.projectId ? getProject(p.data.projectId)?.path : undefined;
  if (!dir) return bad("Not found.", 404);
  if (process.platform !== "darwin") return bad(`Open this folder yourself: ${dir}`);
  const r = await run("open", [dir], { timeoutMs: 5000 });
  if (r.code !== 0) return bad("Could not open Finder.");
  return Response.json({ ok: true });
}
