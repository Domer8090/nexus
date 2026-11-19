import type { IntakeQuestion } from "@/lib/intake";
import { OLLAMA_URL } from "./agents/ollama";

/**
 * Local-model side of prompt intelligence. Everything goes to the Ollama server on 127.0.0.1.
 * Nexus prefers a small ("light") model so questions and polishing stay fast.
 */

export const LIGHT_MODELS: { name: string; size: string }[] = [
  { name: "llama3.2:1b", size: "1.3 GB" },
  { name: "llama3.2:3b", size: "2.0 GB" },
];

const PREFERRED = ["llama3.2:3b", "llama3.2:1b", "qwen3:1.7b", "gemma3:1b", "gemma3:4b", "phi4-mini", "qwen3:4b"];

export type LocalModel = { name: string; bytes: number };

export async function localModels(): Promise<LocalModel[] | null> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const j = (await r.json()) as { models?: { name: string; size?: number }[] };
    return (j.models ?? []).map((m) => ({ name: m.name, bytes: m.size ?? 0 }));
  } catch {
    return null;
  }
}

/** The light model Nexus uses for questions and polishing: a preferred small model, else the smallest pulled one. */
export function pickLight(models: LocalModel[]): string | null {
  for (const p of PREFERRED) if (models.some((m) => m.name === p)) return p;
  const small = [...models].filter((m) => m.bytes > 0).sort((a, b) => a.bytes - b.bytes)[0];
  return small?.name ?? models[0]?.name ?? null;
}

export const pickLightName = (names: string[]) => pickLight(names.map((name) => ({ name, bytes: 0 })));

/** One non-streaming chat call with JSON output. */
export async function localJson<T>(model: string, system: string, prompt: string, schema: object, timeoutMs = 60_000): Promise<T> {
  const body: Record<string, unknown> = {
    model,
    stream: false,
    format: schema,
    options: { temperature: 0.3 },
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  };
  if (/^qwen3/.test(model)) body.think = false;
  const r = await fetch(`${OLLAMA_URL}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`Ollama returned ${r.status}.`);
  const j = (await r.json()) as { message?: { content?: string } };
  return JSON.parse((j.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "")) as T;
}

const Q_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" } } },
        required: ["question", "options"],
      },
    },
  },
  required: ["questions"],
};

const overlap = (a: string, b: string) => {
  const wa = new Set(a.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const wb = b.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  if (!wa.size || !wb.length) return 0;
  return wb.filter((w) => wa.has(w)).length / Math.min(wa.size, wb.length);
};

/** Asks the light local model for up to 3 questions specific to this goal that the classifier didn't cover. */
export async function modelQuestions(model: string, goal: string, existing: IntakeQuestion[]): Promise<IntakeQuestion[]> {
  const system =
    "You help a person describe software they want an AI coding agent to build. Ask short clarifying questions that change what gets built. Each question has 2 to 4 short answer options. Never ask about budget, deadlines or API keys. Reply in JSON.";
  const prompt = `Request: """${goal.slice(0, 2000)}"""\n\nAlready asked:\n${existing.map((q) => `- ${q.text}`).join("\n") || "- nothing"}\n\nWrite up to 3 NEW questions specific to this request that are not already asked.`;
  const out = await localJson<{ questions?: { question?: string; options?: string[] }[] }>(model, system, prompt, Q_SCHEMA);
  const qs: IntakeQuestion[] = [];
  for (const [i, x] of (out.questions ?? []).entries()) {
    const text = String(x.question ?? "").trim().slice(0, 140);
    const options = (x.options ?? []).map((o) => String(o).trim().slice(0, 60)).filter(Boolean).slice(0, 4);
    if (text.length < 8 || options.length < 2) continue;
    if ([...existing, ...qs].some((e) => overlap(e.text, text) > 0.5)) continue;
    qs.push({ id: `m${i}`, slot: "features", text: text.endsWith("?") ? text : `${text}?`, why: `Asked by ${model} on this machine`, options, multi: false, freeText: true, source: "local-model" });
    if (qs.length >= 3) break;
  }
  return qs;
}

/**
 * Sharpens the brief with the light model. Small models rewrite and invent when asked to edit a
 * whole document, so the model only proposes concrete scope items; Nexus inserts them as an
 * optional section and leaves the user's goal and decisions untouched.
 */
export async function polishBrief(model: string, goal: string, brief: string): Promise<string> {
  const system =
    "You help scope software for an AI coding agent. Given a request and its brief, list 3 to 6 concrete, testable items the first version should include (screens, interactions, states, edge cases). Each item under 15 words. Only things that follow from the request and the user's decisions. No technologies the user did not mention. Reply in JSON.";
  const prompt = `Request: """${goal.slice(0, 2000)}"""\n\nBrief:\n${brief.slice(0, 6000)}`;
  const out = await localJson<{ items?: string[] }>(model, system, prompt, { type: "object", properties: { items: { type: "array", items: { type: "string" } } }, required: ["items"] }, 60_000);
  const items = (out.items ?? []).map((x) => String(x).trim().replace(/^[-*]\s*/, "").slice(0, 140)).filter((x) => x.length > 3).slice(0, 6);
  if (items.length < 2) throw new Error("The local model returned too little, so the template prompt was kept.");
  const section = `## Suggested scope (optional, from ${model}; remove what you don't want)\n${items.map((i) => `- ${i}`).join("\n")}\n\n`;
  const without = brief.replace(/## Suggested scope[^\n]*\n(?:- .*\n?)*\n?/, "");
  return without.includes("## Constraints") ? without.replace("## Constraints", `${section}## Constraints`) : `${without.trim()}\n\n${section}`;
}
