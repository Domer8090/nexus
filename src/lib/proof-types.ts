/** Client-safe types for proof checks, explanations and help requests. */
export type ProofKind = "claim" | "test-weakened" | "stub" | "secret" | "suppressed" | "package";
export type ProofItem = { kind: ProofKind; level: "bad" | "warn"; file?: string; line?: number; text: string };
export type Proof = { items: ProofItem[]; evidence: string[]; newPackages: string[]; truncated: boolean };

export const READERS = { beginner: "Someone new to code", teammate: "A teammate who codes", designer: "Someone who doesn't code" } as const;
export type Reader = keyof typeof READERS;
export type Explanation = { summary: string; how: string[]; terms: { term: string; meaning: string }[]; quiz: { q: string; a: string }[]; engine: string; reader: Reader };

export type Verdict = "good" | "changes" | "question";
export type HelpReply = { from: string; verdict: Verdict; overall: string; notes: { file: string; text: string }[]; at: string };
export type HelpState = { id: string; ask: string; at: string; replies: HelpReply[]; explanation: Explanation | null };
