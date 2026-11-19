import type { AgentStatus, SessionRole } from "./types";

/**
 * Picks the model for one job from what the agent actually has, with plain rules:
 *
 * - Local models (Ollama): background jobs (plan, copy, review) get the strongest pulled model that
 *   a laptop runs comfortably (the most parameters up to 16B); code jobs prefer a "coder" model.
 *   The light model stays for interactive work (questions, prompt polish), where speed matters.
 * - Claude Code: the build gets Opus, the other jobs Sonnet. A model you set in Settings wins.
 * - Codex: the first model in Codex's own list (its highest priority). A model set in Settings wins.
 *
 * Returns null to mean "the agent's own default".
 */

const COMFORT_B = 16;

/** Parameter count in billions from a tag like "llama3.1:8b" or "qwen3:4b"; null if the tag doesn't say. */
export function paramsB(name: string): number | null {
  const m = name.toLowerCase().match(/[:\-_](\d+(?:\.\d+)?)b\b/);
  return m ? Number(m[1]) : null;
}

export function bestLocalModel(models: string[], role: SessionRole): string | null {
  const usable = models.filter((m) => !/embed|vision|llava|whisper|rerank/i.test(m));
  if (!usable.length) return models[0] ?? null;
  const wantCode = role === "build" || role === "solo" || role === "revise" || role === "parallel";
  const score = (m: string) => {
    const p = paramsB(m) ?? 3;
    const fits = p <= COMFORT_B ? 1000 : 0;
    const coder = /code|coder/i.test(m) ? (wantCode ? 500 : -500) : 0;
    return fits + coder + (p <= COMFORT_B ? p : -p);
  };
  return [...usable].sort((a, b) => score(b) - score(a))[0];
}

export function bestModel(a: AgentStatus, role: SessionRole, set: { claudeModel?: string | null; codexModel?: string | null } = {}): string | null {
  if (a.kind === "local-runtime") return bestLocalModel(a.models, role);
  if (a.id === "claude-code") return set.claudeModel ?? (role === "build" ? "opus" : "sonnet");
  if (a.id === "codex") return set.codexModel ?? a.modelInfo?.[0]?.id ?? a.models[0] ?? null;
  return null;
}
