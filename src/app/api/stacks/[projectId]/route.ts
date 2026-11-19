import { connection } from "next/server";
import { z } from "zod";
import { bad, body } from "@/lib/api";
import { exportManifest, getStack, saveStack } from "@/runtime/stacks";
import { getProject } from "@/runtime/workspace";
import { STACK_STAGES } from "@/lib/types";

export async function GET(req: Request, ctx: RouteContext<"/api/stacks/[projectId]">) {
  await connection();
  const { projectId } = await ctx.params;
  const proj = getProject(projectId);
  if (!proj) return bad("Project not found.", 404);
  const stack = getStack(projectId);
  if (new URL(req.url).searchParams.get("export") === "1") {
    return new Response(JSON.stringify(exportManifest(stack, proj.name), null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${proj.name}-skill-stack.json"` },
    });
  }
  return Response.json({ stack });
}

const schema = z.object({
  instructions: z.string().max(4000),
  items: z.array(z.object({ id: z.string().regex(/^[\w.-]+\/[\w.-]+@[\w.:-]+$/), stage: z.enum(STACK_STAGES as [string, ...string[]]) })).max(60),
});

export async function PUT(req: Request, ctx: RouteContext<"/api/stacks/[projectId]">) {
  const { projectId } = await ctx.params;
  if (!getProject(projectId)) return bad("Project not found.", 404);
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad("Invalid stack.");
  return Response.json({ stack: saveStack({ projectId, instructions: p.data.instructions, items: p.data.items as never, updatedAt: "" }) });
}
