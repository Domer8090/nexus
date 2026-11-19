import { connection } from "next/server";
import { z } from "zod";
import { bad, body } from "@/lib/api";
import { canLaunch, detectAll, getAdapter } from "@/runtime/agents/registry";
import { createWorkflow, listSessions, listWorkflows } from "@/runtime/sessions";
import { getProject } from "@/runtime/workspace";
import { CONCISE_MODES, PRESETS } from "@/lib/types";

const schema = z.object({
  projectId: z.string(),
  preset: z.enum(PRESETS),
  goal: z.string().trim().min(1).max(8000),
  brief: z.string().trim().min(1).max(40000),
  skills: z.array(z.string().max(200)).max(12),
  concise: z.enum(CONCISE_MODES),
  permissions: z.object({ editFiles: z.boolean(), runShell: z.boolean(), network: z.boolean(), isolate: z.boolean() }),
  tasks: z
    .array(
      z.object({
        role: z.enum(["solo", "plan", "build", "review", "parallel", "copy", "assets"]),
        agentId: z.string(),
        title: z.string().max(120),
        brief: z.string().trim().min(1).max(40000),
        model: z.string().max(80).nullable().optional(),
        dependsOnIndex: z.number().int().min(0).max(10).nullable().optional(),
        afterIndexes: z.array(z.number().int().min(0).max(10)).max(6).optional(),
        shareWorktreeOfIndex: z.number().int().min(0).max(10).nullable().optional(),
        optional: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(6),
});

export async function GET() {
  await connection();
  const workflows = listWorkflows();
  return Response.json({ workflows: workflows.map((w) => ({ ...w, sessions: listSessions({ workflowId: w.id }) })) });
}

/** Creates a workflow and queues its sessions. Only launchable, signed-in agents are accepted. */
export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid request.");
  if (!getProject(p.data.projectId)) return bad("Select a project first.");
  const agents = await detectAll();
  for (const t of p.data.tasks) {
    const st = agents.find((a) => a.id === t.agentId);
    if (!st || !getAdapter(t.agentId)?.launch || !canLaunch(st)) return bad(`${st?.displayName ?? t.agentId} is not ready to run. Check Agents.`);
    const i = p.data.tasks.indexOf(t);
    const refs = [t.dependsOnIndex, t.shareWorktreeOfIndex, ...(t.afterIndexes ?? [])].filter((x): x is number => x != null);
    if (refs.some((r) => r >= i)) return bad("A step can only depend on an earlier step.");
  }
  const r = await createWorkflow(p.data);
  return Response.json(r);
}
