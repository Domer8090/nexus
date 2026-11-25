export type AskQuestion = { id: string; text: string; options: string[]; source: "nexus" | "local" | "agent"; from: string; answer: string | null; skipped?: boolean; at: string; answeredAt: string | null };
export type AskState = { questions: AskQuestion[]; generating: boolean; canApply: boolean };

/** Given to agents that edit files. They never wait for the answer: later steps get it. */
export const ASK_INSTRUCTION =
  "If you reach a choice only the user can make, write one line `- [?] question | option A | option B` (2 to 4 short options), then continue with the most sensible option and keep it easy to change. At most two, never about secrets or keys, and none if the context already answers it.";

/** Reads `- [?] question | A | B`. Placeholders copied from the instruction are ignored. */
export function parseStuck(line: string): { text: string; options: string[] } | null {
  const m = line.match(/^\s*[-*] \[\?\] (.+)$/);
  if (!m) return null;
  const [text, ...options] = m[1].split("|").map((x) => x.replace(/`/g, "").trim()).filter(Boolean);
  if (!text || text.length < 8 || text.length > 200 || options.length < 2 || /^option a$/i.test(options[0])) return null;
  return { text, options: options.slice(0, 4).map((o) => o.slice(0, 80)) };
}

const COMMON = new Set("what which should would could will does have that this with they them their when where your most want need there about like must".split(" "));
const words = (s: string) => (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !COMMON.has(w));
export function sameQuestion(a: string, b: string) {
  const wa = new Set(words(a));
  const wb = words(b);
  if (!wa.size || !wb.length) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return wb.filter((w) => wa.has(w)).length / Math.min(wa.size, wb.length) > 0.6;
}
