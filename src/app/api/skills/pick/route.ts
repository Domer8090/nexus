import { z } from "zod";
import { bad, body } from "@/lib/api";
import { localModels, pickLight } from "@/runtime/intake";
import { localSkills, pickSkills, rankSkills } from "@/runtime/skill-pick";
import { getProject } from "@/runtime/workspace";

const schema = z.object({ task: z.string().trim().min(1).max(12000), projectId: z.string().nullable().optional() });

/** Installed skills that fit the task: keyword ranking, then the light local model chooses. */
export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid request.");
  const project = p.data.projectId ? getProject(p.data.projectId) : null;
  const all = localSkills(project?.path ?? null);
  const candidates = rankSkills(p.data.task, all);
  const models = await localModels();
  const model = models ? pickLight(models) : null;
  const t0 = Date.now();
  if (!model || !candidates.length) {
    return Response.json({ picks: candidates.slice(0, 3).map((c) => ({ name: c.name, why: "Closest keyword match" })), model: null, installed: all.length, candidates: candidates.length, engine: "keyword ranking" });
  }
  try {
    const picks = await pickSkills(model, p.data.task, candidates);
    return Response.json({ picks, model, installed: all.length, candidates: candidates.length, ms: Date.now() - t0, engine: `${model} on this machine` });
  } catch (e) {
    return Response.json({ picks: candidates.slice(0, 3).map((c) => ({ name: c.name, why: "Closest keyword match" })), model, installed: all.length, candidates: candidates.length, error: (e as Error).message, engine: "keyword ranking" });
  }
}
