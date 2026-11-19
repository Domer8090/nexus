import { z } from "zod";
import { bad, body } from "@/lib/api";
import { analyzeGoal } from "@/lib/intake";
import { detectStack } from "@/runtime/brief";
import { LIGHT_MODELS, localModels, pickLight } from "@/runtime/intake";
import { which } from "@/runtime/proc";
import { getProject } from "@/runtime/workspace";

const schema = z.object({ goal: z.string().trim().min(1, "Describe what you want built first.").max(8000), projectId: z.string().nullable().optional() });

/** Instant analysis with the on-device classifier, plus which light local model is available. */
export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid request.");
  const proj = p.data.projectId ? getProject(p.data.projectId) : null;
  const stack = proj ? detectStack(proj.path) : [];
  const analysis = analyzeGoal(p.data.goal, { hasStack: stack.length > 0 });
  const models = await localModels();
  const light = models ? pickLight(models) : null;
  return Response.json({
    analysis,
    stack,
    local: {
      ollama: !which("ollama") ? "not-installed" : models === null ? "not-running" : "running",
      model: light,
      pullable: LIGHT_MODELS,
    },
  });
}
