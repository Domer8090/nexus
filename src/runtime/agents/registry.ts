import type { AgentStatus } from "@/lib/types";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { detectOnlyAdapters } from "./detect-only";
import { ollamaAdapter } from "./ollama";
import type { AgentAdapter } from "./types";

export const ADAPTERS: AgentAdapter[] = [claudeAdapter, codexAdapter, ollamaAdapter, ...detectOnlyAdapters];

export function getAdapter(id: string) {
  return ADAPTERS.find((a) => a.id === id);
}

let cache: { at: number; value: AgentStatus[] } | null = null;

/** Forget cached detection, e.g. after an agent reports that its sign-in expired. */
export function invalidateDetection() {
  cache = null;
}

/** Detection is cached for 30 s; pass force to re-check. */
export async function detectAll(force = false): Promise<AgentStatus[]> {
  if (!force && cache && Date.now() - cache.at < 30_000) return cache.value;
  const value = await Promise.all(
    ADAPTERS.map(async (a) => {
      try {
        const d = await a.detect();
        return { ...a.meta, ...d, checkedAt: new Date().toISOString() } satisfies AgentStatus;
      } catch (e) {
        return {
          ...a.meta,
          install: "error",
          version: null,
          binaryPath: null,
          auth: "unavailable",
          authDetail: `Detection failed: ${(e as Error).message}`,
          accountFacts: [],
          models: [],
          checkedAt: new Date().toISOString(),
        } satisfies AgentStatus;
      }
    }),
  );
  cache = { at: Date.now(), value };
  return value;
}

export function canLaunch(s: AgentStatus) {
  const a = getAdapter(s.id);
  return !!a?.launch && s.install === "installed" && (s.auth === "authenticated" || s.auth === "not-required") && (s.kind !== "local-runtime" || s.models.length > 0);
}
