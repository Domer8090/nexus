import { connection } from "next/server";
import { bad, body } from "@/lib/api";
import { getWorkflow, listSessions, saveWorkflow } from "@/runtime/sessions";
import { diff, overlaps } from "@/runtime/workspace";

export async function GET(_req: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const w = getWorkflow(id);
  if (!w) return bad("Workflow not found.", 404);
  const sessions = listSessions({ workflowId: id });
  // Team steps share one worktree, so count each folder once.
  const seen = new Set<string>();
  const changed = await Promise.all(
    sessions
      .filter((s) => s.permissions.editFiles && s.baseRef && ["completed", "failed", "cancelled"].includes(s.status))
      .filter((s) => (seen.has(s.cwd) ? false : (seen.add(s.cwd), true)))
      .map(async (s) => {
        const d = await diff(s.cwd, s.baseRef);
        return { sessionId: s.id, files: "error" in d ? [] : d.files.map((f) => f.path) };
      }),
  );
  return Response.json({ workflow: w, sessions, overlaps: overlaps(changed) });
}

/** Save a workflow (and rename it) so it shows under saved workflows. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/workflows/[id]">) {
  const { id } = await ctx.params;
  const w = getWorkflow(id);
  if (!w) return bad("Workflow not found.", 404);
  const b = await body<{ saved?: boolean; name?: string }>(req);
  const next = { ...w, saved: b?.saved ?? w.saved, name: typeof b?.name === "string" && b.name.trim() ? b.name.trim().slice(0, 80) : w.name };
  saveWorkflow(next);
  return Response.json({ workflow: next });
}
