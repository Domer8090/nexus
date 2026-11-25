import { parseStuck, sameQuestion } from "@/lib/ask-types";
import { describe, expect, it } from "vitest";
import { expireHackathon, allowedIn, parseScores, recommendMode, timeLeft, type Hackathon } from "@/lib/modes";
import { actionsOf, planOf, trailOf, whereIs } from "@/lib/where";
import { hackathonTasks, slug } from "@/runtime/build";
import type { AgentEvent } from "@/lib/types";

const h: Hackathon = { name: "H", theme: "", rubric: "Design", idea: "An idea", endsAt: "2026-11-30T08:00:00.000Z", runCommands: false, projectId: null, workflowId: null, endedAt: null };
const at = Date.parse(h.endsAt);
const ev = (id: number, kind: AgentEvent["kind"], text: string, data?: Record<string, unknown>): AgentEvent => ({ id, sessionId: "s", at: "", kind, text, data });

describe("modes", () => {
  it("suggests a mode from the answers", () => {
    expect(recommendMode({ level: "new", goal: "make", detail: "everything" })).toBe("beginner");
    expect(recommendMode({ level: "some", goal: "make", detail: "result" })).toBe("beginner");
    expect(recommendMode({ level: "some", goal: "existing", detail: "result" })).toBe("advanced");
    expect(recommendMode({ level: "new", goal: "hackathon", detail: "result" })).toBe("hackathon");
  });
  it("goes back to Advanced when a hackathon ends, and leaves other modes alone", () => {
    expect(expireHackathon({ mode: "hackathon", hackathon: h }, at - 1).mode).toBe("hackathon");
    const over = expireHackathon({ mode: "hackathon", hackathon: h }, at);
    expect(over.mode).toBe("advanced");
    expect(over.hackathon?.endedAt).toBe(h.endsAt);
    expect(expireHackathon({ mode: "beginner", hackathon: h }, at).mode).toBe("beginner");
  });
  it("lets a new hackathon be set up after the last one ended", () => {
    expect(expireHackathon({ mode: "hackathon", hackathon: { ...h, endedAt: h.endsAt } }, at + 5).mode).toBe("hackathon");
  });
  it("reads scores and drops malformed ones", () => {
    expect(parseScores('x\n```json\n{"scores":[{"criterion":"Design","score":7,"why":"ok","fix":"more"},{"criterion":"Bad","score":99}]}\n```')).toEqual([{ criterion: "Design", score: 7, why: "ok", fix: "more" }]);
    expect(parseScores("no json")).toEqual([]);
  });
  it("keeps Beginner and Advanced screens apart", () => {
    expect(allowedIn("beginner", "/advanced")).toBe(false);
    expect(["/", "/playground", "/runs", "/runs/wf_1"].some((p) => allowedIn("advanced", p))).toBe(false);
    expect(allowedIn("advanced", "/advanced") && allowedIn("advanced", "/settings") && allowedIn("beginner", "/runs/x")).toBe(true);
  });
  it("counts down", () => {
    expect(timeLeft(h.endsAt, at - 90_061_000)).toBe("1d 01:01:01");
    expect(timeLeft(h.endsAt, at + 1)).toBe("00:00:00");
  });
});

describe("where the agent is", () => {
  it("names the file or command and keeps a trail", () => {
    const events = [ev(1, "tool", "Read: /p/src/a.ts"), ev(2, "tool", "Edit: /p/src/b.ts"), ev(3, "file", "/p/src/b.ts"), ev(4, "tool", "Read: /p/src/b.ts")];
    expect(whereIs(events, "/p")).toMatchObject({ verb: "Reading", target: "src/b.ts" });
    expect(trailOf(events, "/p")).toEqual([{ file: "src/b.ts", kind: "edit" }, { file: "src/a.ts", kind: "read" }]);
    expect(whereIs([ev(1, "tool", "Bash: npm test", { test: true })], "/p")).toMatchObject({ verb: "Running tests", target: "npm test" });
    expect(whereIs([], "/p")).toBeNull();
  });
});

describe("checklist", () => {
  it("reads a written checklist split across chunks, and marks the next step", () => {
    const e = [ev(1, "text", "- [ ] Make the pa"), ev(2, "text", "ge\n- [ ] Test it\n"), ev(3, "tool", "Edit: /p/a.ts"), ev(4, "text", "- [x] Make the page\n")];
    expect(planOf(e, true)).toEqual([{ text: "Make the page", status: "done" }, { text: "Test it", status: "active" }]);
    expect(planOf(e, false)[1].status).toBe("todo");
  });
  it("prefers the agent's own task tool, and falls back to its actions", () => {
    expect(planOf([ev(1, "text", "- [ ] x\n"), ev(2, "status", "", { plan: [{ text: "A", status: "active" }] })], true)).toEqual([{ text: "A", status: "active" }]);
    expect(actionsOf([ev(1, "tool", "Read: /p/a.ts"), ev(2, "tool", "Edit: /p/b.ts"), ev(3, "file", "/p/b.ts")], "/p", true)).toEqual([{ text: "Read a.ts", status: "done" }, { text: "Editing b.ts", status: "active" }]);
  });
});

describe("questions on the side", () => {
  it("reads what an agent is stuck on and ignores the template and plain checklists", () => {
    expect(parseStuck("- [?] Should data leave the phone? | No | Yes, sync it")).toEqual({ text: "Should data leave the phone?", options: ["No", "Yes, sync it"] });
    expect(parseStuck("- [?] question here | option A | option B")).toBeNull();
    expect(parseStuck("- [ ] Make the page")).toBeNull();
  });
  it("spots a repeated question", () => {
    expect(sameQuestion("Who is the main audience for this?", "Who is the main audience?")).toBe(true);
    expect(sameQuestion("Who is the main audience?", "Which colours fit best?")).toBe(false);
  });
});

describe("hackathon pipeline", () => {
  it("is six steps, with the submission written beside the tests, and never claims commands it can't run", () => {
    const t = hackathonTasks(h, { coder: { id: "c", model: "m" }, writer: null, scribe: { id: "x", model: null }, reviewer: { id: "r", model: null, edits: true } }, 10);
    expect(t.map((x) => x.role)).toEqual(["build", "build", "build", "build", "build", "review"]);
    expect(t.slice(1).map((x) => x.afterIndexes)).toEqual([[0], [1], [2], [1], [3, 4]]);
    expect(t[4].agentId).toBe("x");
    expect(t[1].brief).toContain("cannot run commands");
    expect(t[4].brief).toContain("**YOU:**");
  });
  it("makes safe folder names", () => {
    expect(slug("../../Evil Name!! one two three four five six")).toBe("evil-name-one-two-three-four");
    expect(slug("日本")).toBe("project");
  });
});
