import { connection } from "next/server";
import { bad } from "@/lib/api";
import { getSession } from "@/runtime/sessions";
import { scopeFlags, summarize } from "@/runtime/review";
import { diff } from "@/runtime/workspace";

/**
 * Scope checks for a session's changes. `?ai=1` adds the local model's one-line summaries;
 * without it the answer comes from the diff alone and is instant.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[id]/review">) {
  await connection();
  const { id } = await ctx.params;
  const s = getSession(id);
  if (!s) return bad("Session not found.", 404);
  if (!s.permissions.editFiles) return Response.json({ files: [], engine: { kind: "rules" }, applied: [] });
  const d = await diff(s.cwd, s.baseRef);
  if ("error" in d) return Response.json({ files: [], engine: { kind: "rules" }, note: d.error, applied: [] });
  const files = scopeFlags(s.brief, d.files);
  const ai = new URL(req.url).searchParams.get("ai") === "1";
  const r = ai ? await summarize(s.brief, files, d.patch) : { files, engine: { kind: "rules" as const } };
  return Response.json({ ...r, applied: s.appliedFiles ?? [] });
}
