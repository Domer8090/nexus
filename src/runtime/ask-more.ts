import { analyzeGoal } from "@/lib/intake";
import { sameQuestion } from "@/lib/ask-types";
import { addQuestions, getAsk, saveAsk } from "./ask-store";
import { localModels, modelQuestions, pickLight } from "./intake";

/** Starts a run's questions at once from rules, then adds more from the local model in the background. */

const HACK = [
  { text: "What should a judge remember an hour later?", options: ["It solves a real problem", "It looks beautiful", "The idea is new", "It works perfectly"] },
  { text: "How will you show the demo?", options: ["Live on a laptop", "Recorded video", "Judges try it themselves"] },
  { text: "What must work without failing in the demo?", options: ["One main flow", "Sign-in and saving", "The AI part", "Everything on screen"] },
  { text: "Who is the one person this is for?", options: ["A student", "A teacher or parent", "A small business", "Someone who needs support"] },
  { text: "What should be left out?", options: ["Accounts and sign-in", "Payments", "Extra pages", "Nothing"] },
];

const g = globalThis as unknown as { __nexusAskGen?: Set<string> };
const busy = (g.__nexusAskGen ??= new Set());
export const generating = (id: string) => busy.has(id);

export function seedAsk(id: string, goal: string, kind: "hackathon" | "run") {
  const s = getAsk(id);
  // A different idea starts over; small edits keep the answers.
  if (s.goal !== goal) saveAsk(id, { goal, questions: id.startsWith("draft") && s.goal && !sameQuestion(s.goal, goal) ? [] : s.questions });
  if (kind === "hackathon")
    addQuestions(
      id,
      [...HACK, ...analyzeGoal(goal, { hasStack: false }).questions.filter((q) => q.options.length > 1)].map((q) => ({ text: q.text, options: q.options, source: "nexus" as const, from: "Nexus" })),
    );
  void more(id);
}

/** Keeps at least three questions ready, so the next one is there before this one is answered. */
export async function more(id: string) {
  const s = getAsk(id);
  const local = s.questions.filter((q) => q.source === "local");
  const open = s.questions.filter((q) => q.answer === null && !q.skipped);
  if (busy.has(id) || !s.goal || local.length >= 9 || (local.length > 0 && open.length >= 3)) return;
  busy.add(id);
  try {
    const models = await localModels();
    const model = models ? pickLight(models) : null;
    if (!model) return;
    const said = s.questions.filter((q) => q.answer).map((q) => `${q.text} ${q.answer}`).join("\n");
    const qs = await modelQuestions(model, `${s.goal}${said ? `\n\nAlready decided:\n${said}` : ""}`, s.questions.map((q) => ({ id: q.id, slot: "features", text: q.text, why: "", options: [], multi: false, freeText: true, source: "local-model" })));
    if (getAsk(id).goal !== s.goal) return; // the idea changed meanwhile
    addQuestions(id, qs.map((q) => ({ text: q.text, options: q.options, source: "local" as const, from: "Nexus" })));
  } catch {
    // No local model, or it answered badly: the questions there are still stand.
  } finally {
    busy.delete(id);
  }
}
