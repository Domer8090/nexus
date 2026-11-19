import { z } from "zod";
import { bad, body } from "@/lib/api";
import { DOMAINS } from "@/lib/intake";
import { detectAll } from "@/runtime/agents/registry";
import { localModels, pickLight } from "@/runtime/intake";
import { getSettings } from "@/runtime/settings";
import { planSwarm } from "@/runtime/swarm";

const schema = z.object({
  goal: z.string().trim().min(1).max(8000),
  brief: z.string().trim().min(1).max(40000),
  domain: z.enum(DOMAINS),
  answers: z.record(z.string(), z.string().max(1000)).default({}),
});

/** Assigns each job to the best ready agent. */
export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid request.");
  const [agents, models] = await Promise.all([detectAll(), localModels()]);
  const s = getSettings();
  return Response.json(planSwarm({ ...p.data, agents, lightModel: models ? pickLight(models) : null, claudeModel: s.claudeModel, codexModel: s.codexModel }));
}
