/** The three ways to use Nexus, and the onboarding answers that suggest one. Client-safe. */
export const UI_MODES = ["beginner", "advanced", "hackathon"] as const;
export type UiMode = (typeof UI_MODES)[number];

export const MODE_INFO: Record<UiMode, { label: string; body: string }> = {
  beginner: { label: "Beginner", body: "Describe it, answer a few questions, approve, review." },
  advanced: { label: "Advanced", body: "Every agent's terminal, command and process." },
  hackathon: { label: "Hackathon", body: "PRD, build, tests and submission against the clock." },
};

/** Each mode's own screens. Beginner never shows the terminals; Advanced never shows Beginner's screens. */
export const modeHome = (m: UiMode) => (m === "advanced" ? "/advanced" : "/");
export function allowedIn(m: UiMode, path: string) {
  if (m === "advanced") return path !== "/" && !/^\/(playground|runs)(\/|$)/.test(path);
  return !/^\/advanced(\/|$)/.test(path) && !(m === "hackathon" && /^\/playground(\/|$)/.test(path));
}

export const LEVELS = ["new", "some", "comfortable"] as const;
export const GOALS = ["make", "existing", "hackathon"] as const;
export const DETAILS = ["result", "everything"] as const;
export type Profile = { level: (typeof LEVELS)[number]; goal: (typeof GOALS)[number]; detail: (typeof DETAILS)[number] };

export function recommendMode(p: Profile): UiMode {
  if (p.goal === "hackathon") return "hackathon";
  if (p.level === "new") return "beginner";
  if (p.level === "some" && p.detail === "result" && p.goal === "make") return "beginner";
  return "advanced";
}

export type Hackathon = {
  name: string;
  theme: string;
  /** Judging criteria, one per line. */
  rubric: string;
  idea: string;
  endsAt: string;
  runCommands: boolean;
  projectId: string | null;
  workflowId: string | null;
  endedAt: string | null;
  startedAt?: string;
};

/** Given to each step as it starts, so late steps know how late it is. */
export function timeContext(h: Hackathon, now: number): string | null {
  const left = Date.parse(h.endsAt) - now;
  if (h.endedAt || left <= 0) return null;
  const total = h.startedAt ? Date.parse(h.endsAt) - Date.parse(h.startedAt) : 0;
  const mins = Math.round(left / 60_000);
  const time = mins >= 120 ? `about ${Math.round(mins / 60)} hours` : `${mins} minutes`;
  const freeze = left < 2 * 3_600_000 || (total > 0 && left < total * 0.2);
  return `Time left before submission: ${time}.${freeze ? " Feature freeze: add nothing new. Cut unfinished features cleanly, keep the main demo path working, and leave the project in a state that runs." : " Make the main demo path work first, so there is always something to show."}`;
}

/** When the clock runs out the hackathon closes and the app returns to Advanced mode. */
export function expireHackathon<T extends { mode: UiMode; hackathon: Hackathon | null }>(s: T, now: number): T {
  const h = s.hackathon;
  if (!h || h.endedAt || Date.parse(h.endsAt) > now) return s;
  return { ...s, mode: s.mode === "hackathon" ? "advanced" : s.mode, hackathon: { ...h, endedAt: h.endsAt } };
}

export type Score = { criterion: string; score: number; why: string; fix: string };

/** The reviewer ends with a JSON block of scores. Anything malformed is dropped, never invented. */
export function parseScores(text: string | null | undefined): Score[] {
  const blocks = [...(text ?? "").matchAll(/```json\s*([\s\S]*?)```/g)];
  for (const b of blocks.reverse()) {
    try {
      const j = JSON.parse(b[1]) as { scores?: Partial<Score>[] };
      const out = (j.scores ?? [])
        .filter((x) => typeof x.criterion === "string" && typeof x.score === "number" && x.score >= 0 && x.score <= 10)
        .map((x) => ({ criterion: x.criterion!.slice(0, 80), score: x.score!, why: String(x.why ?? "").slice(0, 300), fix: String(x.fix ?? "").slice(0, 300) }));
      if (out.length) return out.slice(0, 10);
    } catch {}
  }
  return [];
}

export function timeLeft(endsAt: string, now: number) {
  const s = Math.max(0, Math.floor((Date.parse(endsAt) - now) / 1000));
  const d = Math.floor(s / 86400);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d ? `${d}d ` : ""}${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
