import { z } from "zod";
import { bad, body } from "@/lib/api";
import { detectAll } from "@/runtime/agents/registry";
import { recommend } from "@/runtime/recommend";
import { listInstalled } from "@/runtime/skills/cli";
import { getProject } from "@/runtime/workspace";
import { PREFERENCES, TASK_TYPES } from "@/lib/types";

const schema = z.object({ goal: z.string().max(8000), taskType: z.enum(TASK_TYPES), preference: z.enum(PREFERENCES), projectId: z.string().nullable().optional() });

export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad("Invalid request.");
  const proj = p.data.projectId ? getProject(p.data.projectId) : null;
  const [agents, installed] = await Promise.all([detectAll(), listInstalled(proj?.path ?? null)]);
  return Response.json(recommend({ ...p.data, agents, installed: [...installed.project, ...installed.global] }));
}
