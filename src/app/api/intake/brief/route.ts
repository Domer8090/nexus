import { z } from "zod";
import { bad, body } from "@/lib/api";
import { detectStack } from "@/runtime/brief";
import { localModels, pickLight, polishBrief } from "@/runtime/intake";
import { getProject } from "@/runtime/workspace";
import { buildBrief } from "@/lib/optimizer";
import type { BriefResult } from "@/lib/types";

const schema = z.object({
  goal: z.string().trim().min(1).max(8000),
  projectId: z.string().nullable().optional(),
  decisions: z.array(z.object({ q: z.string().max(300), a: z.string().max(1000) })).max(16).default([]),
  polish: z.boolean().default(false),
  base: z.string().max(40000).optional(),
});

/** Template brief from the goal and answers; with polish, rewritten by the light local model. */
export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid request.");
  const proj = p.data.projectId ? getProject(p.data.projectId) : null;
  const base: BriefResult = buildBrief(p.data.goal, { projectName: proj?.name, stack: proj ? detectStack(proj.path) : [], decisions: p.data.decisions });
  if (!p.data.polish) return Response.json(base);
  const models = await localModels();
  const model = models ? pickLight(models) : null;
  if (!model) return Response.json({ ...base, polishError: "No local model is available." });
  try {
    const t0 = Date.now();
    const brief = await polishBrief(model, p.data.goal, p.data.base ?? base.brief);
    return Response.json({ ...base, brief, changes: [...base.changes, `Added suggested scope from ${model} on this machine in ${((Date.now() - t0) / 1000).toFixed(1)}s.`], engine: { kind: "local-model", agentId: "ollama", model } });
  } catch (e) {
    return Response.json({ ...base, polishError: (e as Error).message });
  }
}
