import fs from "node:fs";
import path from "node:path";
import { buildBrief } from "@/lib/optimizer";
import type { BriefResult, TaskType } from "@/lib/types";
import { ollamaChat, ollamaModels } from "./agents/ollama";

/** Detects the project's stack from files that are cheap and safe to read. */
export function detectStack(projectPath: string): string[] {
  const out: string[] = [];
  const has = (f: string) => fs.existsSync(path.join(projectPath, f));
  try {
    if (has("package.json")) {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const known: [string, string][] = [["next", "Next.js"], ["react", "React"], ["vue", "Vue"], ["svelte", "Svelte"], ["astro", "Astro"], ["tailwindcss", "Tailwind CSS"], ["typescript", "TypeScript"], ["vite", "Vite"], ["express", "Express"], ["vitest", "Vitest"], ["jest", "Jest"]];
      for (const [k, label] of known) if (deps[k]) out.push(label);
      if (!out.length) out.push("Node.js");
    }
  } catch {}
  if (has("pyproject.toml") || has("requirements.txt")) out.push("Python");
  if (has("Cargo.toml")) out.push("Rust");
  if (has("go.mod")) out.push("Go");
  if (has("index.html") && !out.length) out.push("Static HTML");
  return out;
}

/** Optional refinement with a local Ollama model. Nothing leaves the machine. */
export async function refineWithLocalModel(goal: string, base: BriefResult, model: string | null): Promise<BriefResult> {
  const models = await ollamaModels();
  if (!models?.length) throw new Error("No local model is available. Start Ollama and pull a model.");
  const m = model && models.includes(model) ? model : models[0];
  const system = `You improve task briefs for coding agents. Keep the user's intent. Never invent requirements, technologies or data; anything you infer goes under "## Suggested scope (optional...)". Keep the same Markdown sections. Reply with the brief only, no preamble.`;
  const prompt = `User's request:\n"""${goal}"""\n\nCurrent brief:\n${base.brief}\n\nImprove clarity and fill gaps. Keep it under 300 words.`;
  let text = "";
  for await (const c of ollamaChat(m, system, prompt, AbortSignal.timeout(90_000))) text += c.message?.content ?? "";
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!text.includes("## Goal")) throw new Error("The local model returned an unexpected format. Kept the template brief.");
  return {
    ...base,
    brief: text,
    changes: [...base.changes, `Refined wording with the local model ${m} on Ollama.`],
    engine: { kind: "local-model", agentId: "ollama", model: m },
  };
}

export function templateBrief(goal: string, taskType: TaskType | "auto", projectPath: string | null, projectName: string | null, notes?: string) {
  return buildBrief(goal, { taskType, projectName: projectName ?? undefined, stack: projectPath ? detectStack(projectPath) : [], notes });
}
