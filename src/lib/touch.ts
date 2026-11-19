import type { AgentEvent } from "./types";

/**
 * Which file an agent event is about, for the project map: reads (Read, Grep on a path) and edits
 * (Edit, Write, file-change events). Paths are made relative to the session's folder; anything
 * outside it, or a shell command, is not a file touch.
 */

export type Touch = { file: string; kind: "read" | "edit"; at: string; id: number };

const EDIT = /^(Edit|MultiEdit|Write|NotebookEdit)$/;
const READ = /^(Read|NotebookRead)$/;

export function touchOf(e: AgentEvent, cwd: string): Touch | null {
  let kind: Touch["kind"] | null = null;
  let target = "";
  if (e.kind === "file") {
    kind = "edit";
    target = e.text;
  } else if (e.kind === "tool") {
    const m = e.text.match(/^([A-Za-z]+):\s*(.+)$/);
    if (!m) return null;
    if (EDIT.test(m[1])) kind = "edit";
    else if (READ.test(m[1])) kind = "read";
    else return null;
    target = m[2];
  } else return null;
  target = target.trim().replace(/…$/, "");
  const root = cwd.endsWith("/") ? cwd : `${cwd}/`;
  let rel = target.startsWith(root) ? target.slice(root.length) : target.startsWith("/") ? null : target.replace(/^\.\//, "");
  if (!rel || rel.startsWith("..")) return null;
  rel = rel.replace(/\/+$/, "");
  if (!/[\w-]\.[\w]+$|^[\w.-]+$/.test(rel.split("/").pop() ?? "")) return null;
  return { file: rel, kind, at: e.at, id: e.id };
}
