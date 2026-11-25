import { touchOf } from "./touch";
import type { AgentEvent } from "./types";

/** Turns an agent's raw events into where it is right now, in plain words. */
export type Where = { verb: string; target: string; at: string };
export type Trail = { file: string; kind: "read" | "edit" };

function one(e: AgentEvent, cwd: string): Where | null {
  if (e.kind === "text") return e.text.trim() ? { verb: "Writing its reply", target: "", at: e.at } : null;
  if (e.kind === "error") return { verb: "Hit a problem", target: "", at: e.at };
  if (e.kind === "file") {
    const t = touchOf(e, cwd);
    return { verb: "Editing", target: t?.file ?? "a file", at: e.at };
  }
  if (e.kind !== "tool") return null;
  const t = touchOf(e, cwd);
  if (t) return { verb: t.kind === "edit" ? "Editing" : "Reading", target: t.file, at: e.at };
  const m = e.text.match(/^([A-Za-z_]+)(?::\s*([\s\S]*))?$/);
  const tool = m?.[1] ?? "";
  const arg = (m?.[2] ?? "").replaceAll(cwd, ".").split("\n")[0];
  if (/^(Grep|Glob|LS)$/.test(tool)) return { verb: "Searching", target: arg, at: e.at };
  if (/^Web/.test(tool)) return { verb: "Looking online", target: arg, at: e.at };
  if (tool === "Skill") return { verb: "Using a skill", target: arg, at: e.at };
  if (/^(Bash|command|Command|Shell)$/.test(tool)) return { verb: e.data?.test ? "Running tests" : "Running a command", target: arg, at: e.at };
  return { verb: "Working", target: e.text.split("\n")[0].replaceAll(cwd, "."), at: e.at };
}

export function whereIs(events: AgentEvent[], cwd: string): Where | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const w = one(events[i], cwd);
    if (w) return w;
  }
  return null;
}

/** Files in the order the agent last touched them, newest first. An edit outranks a read. */
export function trailOf(events: AgentEvent[], cwd: string, max = 6): Trail[] {
  const kinds = new Map<string, Trail["kind"]>();
  for (const e of events) {
    const t = touchOf(e, cwd);
    if (!t) continue;
    const kind = kinds.get(t.file) === "edit" ? "edit" : t.kind;
    kinds.delete(t.file);
    kinds.set(t.file, kind);
  }
  return [...kinds].map(([file, kind]) => ({ file, kind })).reverse().slice(0, max);
}

export type PlanItem = { text: string; status: "done" | "active" | "todo" };

/** Given to agents that edit files, so any of them can report a plan the same way. */
export const PLAN_INSTRUCTION =
  "Progress list: before your first edit, write your plan as 3 to 7 Markdown lines, each `- [ ] short step`. When a step is finished, write that same line again as `- [x] short step` before you start the next one. Keep the wording identical. Don't mention this list otherwise.";

/** The agent's own plan: from its task tool when it has one, else the checklist it writes. */
export function planOf(events: AgentEvent[], live: boolean): PlanItem[] {
  let native: PlanItem[] | null = null;
  for (const e of events) if (Array.isArray(e.data?.plan) && e.data.plan.length) native = e.data.plan as PlanItem[];
  if (native) return native;
  const done = new Map<string, { text: string; done: boolean }>();
  const text = events.map((e) => (e.kind === "text" ? e.text : "\n")).join("");
  for (const m of text.matchAll(/^\s*[-*] \[([ xX])\] (.+?)\s*$/gm)) {
    const key = m[2].toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    done.set(key, { text: done.get(key)?.text ?? m[2].slice(0, 120), done: m[1] !== " " || !!done.get(key)?.done });
  }
  const items = [...done.values()].slice(0, 12);
  const at = live ? items.findIndex((x) => !x.done) : -1;
  return items.map((x, i) => ({ text: x.text, status: x.done ? "done" : i === at ? "active" : "todo" }));
}

const PAST: Record<string, string> = { Editing: "Edited", Reading: "Read", Searching: "Searched", "Looking online": "Looked online", "Using a skill": "Used", "Running tests": "Ran tests:", "Running a command": "Ran", Working: "Did" };

/** For agents that gave no plan: the last things it did, oldest first, the current one last. */
export function actionsOf(events: AgentEvent[], cwd: string, live: boolean, max = 6): PlanItem[] {
  const out: Where[] = [];
  for (const e of events) {
    if (e.kind !== "tool" && e.kind !== "file") continue;
    const w = one(e, cwd);
    const last = out.at(-1);
    if (w && !(last && last.verb === w.verb && last.target === w.target)) out.push(w);
  }
  return out.slice(-max).map((w, i, a) => {
    const active = live && i === a.length - 1;
    return { text: `${active ? w.verb : PAST[w.verb] ?? w.verb} ${w.target}`.trim(), status: active ? "active" : "done" };
  });
}
