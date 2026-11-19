import { z } from "zod";
import { bad, body } from "@/lib/api";
import { refineWithLocalModel, templateBrief } from "@/runtime/brief";
import { getSettings } from "@/runtime/settings";
import { getProject } from "@/runtime/workspace";
import { TASK_TYPES } from "@/lib/types";

const schema = z.object({
  goal: z.string().trim().min(1, "Describe the goal first.").max(8000, "Keep the goal under 8,000 characters."),
  taskType: z.enum([...TASK_TYPES, "auto"]).default("auto"),
  projectId: z.string().nullable().optional(),
  notes: z.string().max(2000).optional(),
  refine: z.boolean().default(false),
});

export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid request.");
  const proj = p.data.projectId ? getProject(p.data.projectId) : null;
  const base = templateBrief(p.data.goal, p.data.taskType, proj?.path ?? null, proj?.name ?? null, p.data.notes);
  if (!p.data.refine) return Response.json(base);
  try {
    return Response.json(await refineWithLocalModel(p.data.goal, base, getSettings().ollamaModel));
  } catch (e) {
    return Response.json({ ...base, refineError: (e as Error).message });
  }
}
