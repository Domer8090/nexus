import { connection } from "next/server";
import { bad } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { detectStack } from "@/runtime/brief";
import { getProject, gitState, projectScripts, removeProject, touchProject } from "@/runtime/workspace";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const p = getProject(id);
  if (!p) return bad("Project not found.", 404);
  touchProject(id);
  const [git] = await Promise.all([gitState(p.path)]);
  return Response.json({ project: p, git, stack: detectStack(p.path), scripts: projectScripts(p.path) });
}

/** Removes the project from Nexus only. Files on disk are not touched. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  removeProject(id);
  audit("project.remove", id);
  return Response.json({ ok: true });
}
