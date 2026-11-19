import { kvGet, kvSet } from "./db";
import { redact } from "./redact";

/**
 * Project notes: rules and decisions the user writes once, given to every new session in that
 * project so they don't have to explain them again. Stored in Nexus's own database, not in the
 * project, so they reach worktrees too and never end up in a commit.
 */

export const NOTES_MAX = 8000;
type Notes = { text: string; updatedAt: string };

export function getNotes(projectId: string): Notes {
  return kvGet<Notes>(`notes:${projectId}`) ?? { text: "", updatedAt: "" };
}

export function setNotes(projectId: string, text: string): Notes {
  const n = { text: text.slice(0, NOTES_MAX), updatedAt: new Date().toISOString() };
  kvSet(`notes:${projectId}`, n);
  return n;
}

/** Adds one line to the notes, skipping exact duplicates. */
export function addNote(projectId: string, line: string): Notes {
  const cur = getNotes(projectId).text.trim();
  const item = line.trim().replace(/^[-*]\s*/, "");
  if (!item) return getNotes(projectId);
  if (cur.split("\n").some((l) => l.replace(/^[-*]\s*/, "").trim() === item)) return getNotes(projectId);
  return setNotes(projectId, `${cur ? `${cur}\n` : ""}- ${item}`);
}

/** The block added to an agent's context, or null when there are no notes. */
export function notesContext(projectId: string): string | null {
  const t = getNotes(projectId).text.trim();
  if (!t) return null;
  return `Project notes from the user. Follow these rules and decisions unless the task says otherwise:\n${redact(t)}`;
}
