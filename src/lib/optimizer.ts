import type { BriefResult, TaskType } from "./types";
import { TASK_LABELS } from "./types";

/**
 * Deterministic task-brief engine. No network, no model. It keeps the user's words,
 * adds structure, and marks every inferred item as a suggestion.
 */

const KEYWORDS: [TaskType, RegExp][] = [
  ["debug", /\b(bugs?|errors?|fix(es)?|broken|crash(es|ed|ing)?|exceptions?|stack ?trace|doesn'?t work|not working|fails?|failing|regression|slow|freezes?|why\?)/i],
  ["test", /\b(tests?|testing|coverage|unit tests?|e2e|playwright|jest|vitest|spec)\b/i],
  ["refactor", /\b(refactor|clean ?up|restructure|rename|extract|simplify|migrate|upgrade|modernize)\b/i],
  ["review", /\b(review|audit|check (my|the|this)|critique|security review|look over)\b/i],
  ["document", /\b(document|docs|readme|comments?|jsdoc|explain the code|write-?up|changelog)\b/i],
  ["research", /\b(research|compare|evaluate|options for|which library|pros and cons|investigate)\b/i],
  ["plan", /\b(plan|design|architecture|roadmap|spec|requirements|break down|outline)\b/i],
  ["build", /\b(build|create|make|add|implement|website|landing page|app|feature|page|component|dashboard|form|api|endpoint)\b/i],
];

const LEADING: [TaskType, RegExp][] = [
  ["debug", /^(fix|debug|why (does|is|do))/i],
  ["test", /^(write|add) (unit |e2e )?tests/i],
  ["refactor", /^(refactor|clean up|migrate|rename)/i],
  ["review", /^(review|audit)/i],
  ["document", /^(document|write (the )?(docs|readme))/i],
  ["research", /^(research|compare|evaluate)/i],
  ["plan", /^(plan|design|outline)/i],
  ["build", /^(build|create|make|add|implement)/i],
];

const count = (t: string, re: RegExp) => t.match(new RegExp(re.source, "gi"))?.length ?? 0;

export function classify(text: string): TaskType {
  const first = text.split(/(?<=[.!?])\s|\n/)[0] ?? "";
  const scores = new Map<TaskType, number>();
  for (const [t, re] of KEYWORDS) scores.set(t, count(first, re) * 3 + count(text, re));
  for (const [t, re] of LEADING)
    if (re.test(first.trim())) {
      scores.set(t, (scores.get(t) ?? 0) + 6);
      break;
    }
  let best: TaskType = "build";
  let bestScore = 0;
  for (const [t] of KEYWORDS) {
    const s = scores.get(t) ?? 0;
    if (s > bestScore) {
      best = t;
      bestScore = s;
    }
  }
  return best;
}

type Subject = { re: RegExp; noun: string; features: string[] };
const SUBJECTS: Subject[] = [
  { re: /\bclub|society|team\b/i, noun: "club", features: ["What the club does and how to join", "Upcoming events with date, time and place", "Member projects", "Member signup form with validation", "Contact details"] },
  { re: /\blanding page\b/i, noun: "landing page", features: ["Clear headline and one main call to action", "Sections for the key content", "Responsive layout from phone to desktop"] },
  { re: /\bshop|store|e-?commerce\b/i, noun: "shop", features: ["Product list", "Product page", "Cart and checkout"] },
  { re: /\bdashboard\b/i, noun: "dashboard", features: ["Key numbers first", "Trends over time", "Filters"] },
  { re: /\bauth|login|sign ?in\b/i, noun: "sign-in flow", features: ["Sign up, sign in and sign out", "Error states for bad input", "Session handling"] },
];

const DELIVER: Record<TaskType, string[]> = {
  plan: ["A short plan: steps, files involved, risks", "Open questions that need an answer before building", "Do not change any files"],
  build: ["Working code in the project, following its existing conventions", "A short summary of files created or changed", "Exactly how to open and view the result: the file to open in a browser or the command to run"],
  debug: ["The root cause, with evidence", "The smallest fix", "A test or check that proves it is fixed"],
  refactor: ["The refactor, with behavior unchanged", "Tests still passing", "A summary of what moved where"],
  test: ["New or updated tests", "How to run them", "What is still untested"],
  review: ["Findings ranked by severity, with file and line", "Suggested fixes", "Do not change files unless asked"],
  document: ["The documentation in the project's existing format", "Accurate commands and paths only"],
  research: ["Findings with sources", "A recommendation and what would change it", "Do not change files"],
};

const DONE: Record<TaskType, string[]> = {
  plan: ["Every step names the files it touches"],
  build: ["Builds and runs without errors", "Works at phone and desktop widths if it has a UI", "Existing tests still pass"],
  debug: ["The original failure no longer happens", "No new failures"],
  refactor: ["Behavior and public interfaces unchanged", "Tests pass"],
  test: ["Tests fail on the bug they cover and pass after the fix"],
  review: ["Each finding is specific enough to act on"],
  document: ["A newcomer can follow it without other help"],
  research: ["Each claim can be traced to a source"],
};

export function buildBrief(goal: string, opts: { taskType?: TaskType | "auto"; projectName?: string; stack?: string[]; notes?: string; decisions?: { q: string; a: string }[] } = {}): BriefResult {
  const text = goal.trim();
  const taskType = !opts.taskType || opts.taskType === "auto" ? classify(text) : opts.taskType;
  const changes: string[] = [];
  const assumptions: string[] = [];
  const missing: string[] = [];
  const out: string[] = [];

  out.push("## Goal", text.endsWith(".") || text.endsWith("?") ? text : `${text}.`, "");

  const ctx: string[] = [];
  if (opts.projectName) ctx.push(`- Project: ${opts.projectName} (current folder)`);
  if (opts.stack?.length) {
    ctx.push(`- Detected stack: ${opts.stack.join(", ")}. Follow its conventions.`);
    changes.push("Added the stack Nexus detected in the project so the agent follows its conventions.");
  } else if (taskType === "build") {
    ctx.push("- Stack: not detected. Use what the project already uses; if it is empty, pick a simple option and say why.");
    missing.push("stack");
  }
  ctx.push(`- Task type: ${TASK_LABELS[taskType].toLowerCase()}`);
  if (opts.notes?.trim()) ctx.push(`- Notes: ${opts.notes.trim()}`);
  out.push("## Context", ...ctx, "");

  const decisions = (opts.decisions ?? []).filter((d) => d.a.trim());
  if (decisions.length) {
    out.push("## Decisions from the user", ...decisions.map((d) => `- ${d.q.replace(/\?$/, "")}: ${d.a.trim()}`), "");
    changes.push(`Added ${decisions.length} answer${decisions.length === 1 ? "" : "s"} you gave to the clarifying questions.`);
  }

  const subject = taskType === "build" ? SUBJECTS.filter((s) => s.re.test(text)) : [];
  if (subject.length) {
    const feats = Array.from(new Set(subject.flatMap((s) => s.features)));
    out.push("## Suggested scope (optional, remove what you don't want)", ...feats.map((f) => `- ${f}`), "");
    changes.push(`Listed likely parts of a ${subject.map((s) => s.noun).join(" and ")}, marked optional.`);
    assumptions.push(`Suggested scope is inferred from the words "${subject.map((s) => s.noun).join('", "')}". You did not ask for each item.`);
  }

  const rules = [
    "Work only inside this project folder",
    "Do not push, deploy, or rewrite git history",
    "Ask, or state an assumption, when something important is unclear",
  ];
  if (taskType === "build" && /\b(page|site|ui|landing|form|responsive)\b/i.test(text)) {
    rules.push("Suggested: accessible markup (labels, keyboard use, readable contrast)");
    changes.push("Added accessibility expectations, marked as a suggestion.");
  }
  out.push("## Constraints", ...rules.map((r) => `- ${r}`), "");
  changes.push("Added safety constraints: stay in the project folder, no pushes or history rewrites.");

  out.push("## Deliverables", ...DELIVER[taskType].map((d) => `- ${d}`), "");
  out.push("## Done when", ...DONE[taskType].map((d) => `- ${d}`));
  changes.push(`Added deliverables and a done-when list for a ${TASK_LABELS[taskType].toLowerCase()} task.`);

  if (!/\b(test|check|verify)\b/i.test(text) && (taskType === "build" || taskType === "debug")) missing.push("how to verify");

  return { taskType, brief: out.join("\n"), changes, assumptions, missing, engine: { kind: "template" } };
}

/** Line diff (LCS) for the before/after view. */
export function lineDiff(a: string, b: string): { type: "same" | "add" | "del"; text: string }[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const res: { type: "same" | "add" | "del"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      res.push({ type: "same", text: x[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) res.push({ type: "del", text: x[i++] });
    else res.push({ type: "add", text: y[j++] });
  }
  while (i < n) res.push({ type: "del", text: x[i++] });
  while (j < m) res.push({ type: "add", text: y[j++] });
  return res;
}
