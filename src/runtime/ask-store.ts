import { parseStuck, sameQuestion, type AskQuestion } from "@/lib/ask-types";
import { kvGet, kvSet } from "./db";
import { newId } from "./ids";
import { redact } from "./redact";

/**
 * Questions Nexus and its agents have for the person, kept per run (or per draft, before the run
 * exists). Nothing waits on them: every step that starts later gets the answers so far.
 */

type Stored = { goal: string; questions: AskQuestion[] };
const key = (id: string) => `ask:${id}`;

export const getAsk = (id: string): Stored => kvGet<Stored>(key(id)) ?? { goal: "", questions: [] };
export const saveAsk = (id: string, s: Stored) => kvSet(key(id), s);

export function addQuestions(id: string, add: { text: string; options: string[]; source: AskQuestion["source"]; from: string }[], max = 24): number {
  const s = getAsk(id);
  let n = 0;
  for (const q of add) {
    if (s.questions.length >= max) break;
    if (s.questions.some((x) => sameQuestion(x.text, q.text))) continue;
    s.questions.push({ ...q, text: redact(q.text), id: newId("q"), answer: null, at: new Date().toISOString(), answeredAt: null });
    n++;
  }
  if (n) saveAsk(id, s);
  return n;
}

export function answer(id: string, qid: string, text: string | null) {
  const s = getAsk(id);
  const q = s.questions.find((x) => x.id === qid);
  if (!q) return false;
  q.answer = text;
  q.skipped = text === null;
  q.answeredAt = new Date().toISOString();
  saveAsk(id, s);
  return true;
}

/** A draft's questions and answers become the run's. */
export function moveAsk(from: string, to: string, goal: string) {
  saveAsk(to, { ...getAsk(from), goal });
  saveAsk(from, { goal: "", questions: [] });
}

export function answersSince(id: string, since = ""): AskQuestion[] {
  return getAsk(id).questions.filter((q) => q.answer && (q.answeredAt ?? "") > since);
}

export function answersText(qs: AskQuestion[]) {
  return qs.map((q) => `- ${q.text} ${q.answer}`).join("\n");
}

export function answersContext(id: string): string | null {
  const a = answersSince(id);
  return a.length ? `Decisions from the user. Follow them, and change earlier work that disagrees:\n${redact(answersText(a))}` : null;
}

// Agents' text arrives in pieces, so lines are put back together per session.
const g = globalThis as unknown as { __nexusAskBuf?: Map<string, string> };
const buf = (g.__nexusAskBuf ??= new Map());

export function watchText(sessionId: string, text: string, flush: boolean, where: () => { workflowId: string | null; title: string } | null) {
  const all = (buf.get(sessionId) ?? "") + text + (flush ? "\n" : "");
  const lines = all.split("\n");
  buf.set(sessionId, flush ? "" : lines.pop()!.slice(-600));
  const found = lines.map(parseStuck).filter((x) => x !== null);
  if (!found.length) return;
  const w = where();
  if (w?.workflowId) addQuestions(w.workflowId, found.slice(0, 2).map((q) => ({ ...q, source: "agent" as const, from: w.title })), 30);
}
