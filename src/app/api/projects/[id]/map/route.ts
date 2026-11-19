import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { MAP_FILE, buildMap, writeMap } from "@/runtime/project-map";
import { getProject } from "@/runtime/workspace";

/** GET: preview the map. POST {confirm:true}: write NEXUS_MAP.md into the project (git-excluded). */
export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/map">) {
  const p = getProject((await ctx.params).id);
  if (!p) return bad("Project not found.", 404);
  const m = await buildMap(p.path);
  return Response.json({ ...m, file: MAP_FILE });
}

export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/map">) {
  const p = getProject((await ctx.params).id);
  if (!p) return bad("Project not found.", 404);
  if (!z.object({ confirm: z.literal(true) }).safeParse(await body(req)).success) return bad("Confirm first.");
  const r = await writeMap(p.path);
  if ("error" in r) return bad(r.error);
  audit("project.map", `${r.path} files=${r.files} bytes=${r.bytes}`);
  return Response.json(r);
}
