/**
 * Curated starter collections. Every id below was confirmed to exist on skills.sh with
 * `skills find` on 2026-11-17. Inclusion is a starting point, not an endorsement: each
 * skill still goes through the source review before install. Install counts are
 * never stored here; the UI shows live counts from skills.sh with their retrieval time.
 */

export type Collection = { id: string; title: string; summary: string; skills: { id: string; role: string }[]; conflicts?: string };

export const COLLECTIONS: Collection[] = [
  {
    id: "vibe-essentials",
    title: "Vibe coding essentials",
    summary: "Clarify the idea, plan it, then build with tests and review.",
    skills: [
      { id: "obra/superpowers@brainstorming", role: "Turns a rough idea into clear requirements" },
      { id: "obra/superpowers@writing-plans", role: "Writes a step-by-step plan before coding" },
      { id: "anthropics/skills@frontend-design", role: "Design direction for UI work" },
      { id: "obra/superpowers@systematic-debugging", role: "Root-cause debugging" },
      { id: "obra/superpowers@test-driven-development", role: "Tests first, then code" },
      { id: "obra/superpowers@requesting-code-review", role: "Asks for review before finishing" },
    ],
  },
  {
    id: "frontend-studio",
    title: "Frontend studio",
    summary: "Design guidance and browser checks for UI work.",
    skills: [
      { id: "anthropics/skills@frontend-design", role: "Anthropic's frontend design guidance" },
      { id: "pbakaus/impeccable@impeccable", role: "Design polish rules" },
      { id: "nextlevelbuilder/ui-ux-pro-max-skill@ui-ux-pro-max", role: "UI and UX pattern library" },
      { id: "vercel-labs/agent-browser@agent-browser", role: "Drives a browser to check the result" },
    ],
    conflicts: "frontend-design, impeccable and ui-ux-pro-max all steer visual style. Use one as the lead to avoid mixed directions.",
  },
  {
    id: "token-efficiency",
    title: "Token efficiency",
    summary: "Shorter agent output and leaner context.",
    skills: [
      { id: "juliusbrussee/caveman@caveman", role: "Terse output that keeps code exact" },
      { id: "juliusbrussee/caveman@caveman-compress", role: "Compresses memory and prompt files" },
      { id: "juliusbrussee/caveman@caveman-review", role: "One-line review comments" },
    ],
    conflicts: "Caveman changes the agent's writing style everywhere. Nexus's own Concise mode does the same job per session; use one, not both.",
  },
  {
    id: "engineering-quality",
    title: "Engineering quality",
    summary: "Tests, debugging, review and security checks.",
    skills: [
      { id: "obra/superpowers@test-driven-development", role: "Tests first" },
      { id: "obra/superpowers@systematic-debugging", role: "Root-cause debugging" },
      { id: "mattpocock/skills@code-review", role: "Structured code review" },
      { id: "getsentry/skills@security-review", role: "Security review checklist" },
    ],
  },
  {
    id: "research",
    title: "Research and discovery",
    summary: "Find skills and understand unfamiliar code.",
    skills: [{ id: "vercel-labs/skills@find-skills", role: "Finds skills for a task" }],
  },
];

export const ALL_COLLECTION_SKILLS = Array.from(new Set(COLLECTIONS.flatMap((c) => c.skills.map((s) => s.id))));
