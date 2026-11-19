import type { AgentStatus, InstalledSkill, Preference, Recommendation, TaskType } from "@/lib/types";
import { canLaunch } from "./agents/registry";

/**
 * Deterministic, explainable recommender. It only recommends agents Nexus can launch
 * right now, and says why the others are not eligible.
 */

const EDITING: TaskType[] = ["build", "debug", "refactor", "test", "document"];

const SKILL_HINTS: { re: RegExp; ids: string[]; why: string }[] = [
  { re: /\b(page|site|ui|landing|frontend|design|css|responsive|component)\b/i, ids: ["anthropics/skills@frontend-design"], why: "Design direction for UI work" },
  { re: /\b(debug|bug|error|fix|crash|failing)\b/i, ids: ["obra/superpowers@systematic-debugging"], why: "Finds the root cause before changing code" },
  { re: /\b(test|tdd|coverage|signup|form|validation)\b/i, ids: ["obra/superpowers@test-driven-development"], why: "Writes tests alongside the change" },
  { re: /\b(plan|design|architecture|break down)\b/i, ids: ["obra/superpowers@writing-plans"], why: "Writes a plan before coding" },
  { re: /\b(review|audit|security)\b/i, ids: ["obra/superpowers@requesting-code-review"], why: "Structured review before finishing" },
  { re: /\b(idea|brainstorm|not sure|figure out)\b/i, ids: ["obra/superpowers@brainstorming"], why: "Clarifies requirements first" },
];

export function recommend(input: { goal: string; taskType: TaskType; preference: Preference; agents: AgentStatus[]; installed: InstalledSkill[] }): Recommendation {
  const needsEdits = EDITING.includes(input.taskType);
  const scored = input.agents
    .filter((a) => a.integration !== "out-of-scope")
    .map((a) => {
      const reasons: string[] = [];
      const blockers: string[] = [];
      let score = 0;
      if (a.install !== "installed") blockers.push("Not installed");
      else if (a.integration === "detection-only") blockers.push("Nexus can detect it but can't launch sessions yet");
      else if (a.auth === "needs-sign-in") blockers.push("Needs sign-in");
      else if (a.auth === "unknown") blockers.push("Sign-in state unknown");
      if (a.kind === "local-runtime" && a.install === "installed" && a.models.length === 0) blockers.push("No local models available");
      const edits = a.nexusCapabilities.includes("edits-project");
      if (needsEdits && !edits) blockers.push("Can't edit project files from Nexus");
      if (canLaunch(a) && !blockers.length) {
        score += 10;
        if (edits && needsEdits) {
          score += 10;
          reasons.push("edits files in your project through its own tools");
        }
        if (a.auth === "authenticated") reasons.push("signed in with your account");
        if (a.kind === "local-runtime") {
          reasons.push("runs on this machine");
          if (input.preference === "local-only") score += 25;
          if (input.preference === "low-resource") score -= 3;
          if (input.preference === "minimal-tokens") score += 4;
        } else {
          if (input.preference === "quality") score += 6;
          if (input.preference === "local-only") {
            score -= 30;
            blockers.push("Sends your code to its provider, but you asked for local only");
          }
        }
        if (input.preference === "speed" && a.id === "claude-code") reasons.push("pick the Haiku or Sonnet model for faster runs");
      }
      return { agentId: a.id, score: blockers.length ? -1 : score, reasons, blockers };
    })
    .sort((x, y) => y.score - x.score);

  const installedNames = new Set(input.installed.map((s) => s.name.toLowerCase()));
  const picked = new Map<string, string>();
  for (const h of SKILL_HINTS) if (h.re.test(input.goal)) for (const id of h.ids) if (!picked.has(id)) picked.set(id, h.why);
  if (input.preference === "minimal-tokens") picked.set("juliusbrussee/caveman@caveman", "Shorter agent output; overlaps with Nexus Concise mode");
  const skills = [...picked.entries()].slice(0, 4).map(([id, why]) => ({ id, why, installed: installedNames.has(id.split("@")[1].toLowerCase()) }));

  const top = scored.find((s) => s.score >= 0);
  const name = (id: string) => input.agents.find((a) => a.id === id)?.displayName ?? id;
  const rationale = top
    ? `${name(top.agentId)} fits this ${input.taskType} task: it ${top.reasons.join(", ")}.`
    : needsEdits
      ? "No installed, signed-in agent that can edit files is available. Set one up in Agents."
      : "No launchable agent is available. Set one up in Agents.";
  return { agents: scored, skills, rationale };
}
