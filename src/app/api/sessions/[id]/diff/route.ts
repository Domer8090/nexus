import { connection } from "next/server";
import { bad } from "@/lib/api";
import { getSession } from "@/runtime/sessions";
import { diff } from "@/runtime/workspace";

export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[id]/diff">) {
  await connection();
  const { id } = await ctx.params;
  const s = getSession(id);
  if (!s) return bad("Session not found.", 404);
  if (!s.permissions.editFiles) return Response.json({ files: [], patch: "", note: "This session was read-only, so it made no file changes." });
  const d = await diff(s.cwd, s.baseRef);
  if ("error" in d) return Response.json({ files: [], patch: "", note: d.error });
  return Response.json({ ...d, isolated: !!s.worktreeBranch, branch: s.worktreeBranch, base: s.baseRef });
}
