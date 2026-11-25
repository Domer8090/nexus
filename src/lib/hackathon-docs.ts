export const HACK_DOCS = { prd: { label: "PRD", file: "docs/PRD.md" }, submission: { label: "Submission", file: "docs/SUBMISSION.md" }, demo: { label: "Demo script", file: "docs/DEMO.md" }, judges: { label: "Judge Q&A", file: "docs/JUDGE_QA.md" } } as const;
export type HackDoc = keyof typeof HACK_DOCS;
