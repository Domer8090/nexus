import { z } from "zod";
import { bad, body } from "@/lib/api";
import { localModels, modelQuestions, pickLight } from "@/runtime/intake";

const schema = z.object({
  goal: z.string().trim().min(1).max(8000),
  existing: z.array(z.object({ text: z.string().max(300) }).passthrough()).max(30).default([]),
});

/** Extra, goal-specific questions from the light local model on Ollama. */
export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid request.");
  const models = await localModels();
  const model = models ? pickLight(models) : null;
  if (!model) return Response.json({ questions: [], model: null, error: "No local model is available." });
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const questions = await modelQuestions(model, p.data.goal, p.data.existing as any);
    return Response.json({ questions, model });
  } catch (e) {
    return Response.json({ questions: [], model, error: (e as Error).message });
  }
}
