import { describe, expect, it } from "vitest";
import { analyzeGoal, classifyDomain, detectSlots, wantsImages } from "@/lib/intake";
import { buildCodexArgs } from "@/runtime/agents/codex";
import { planSwarm } from "@/runtime/swarm";
import { buildBrief } from "@/lib/optimizer";
import type { AgentStatus } from "@/lib/types";

const agent = (id: string, kind: AgentStatus["kind"], caps: AgentStatus["nexusCapabilities"], models: string[] = []): AgentStatus => ({
  id,
  displayName: id,
  vendor: "",
  kind,
  integration: "supported",
  integrationNote: "",
  install: "installed",
  version: "1",
  binaryPath: "/x",
  auth: kind === "local-runtime" ? "not-required" : "authenticated",
  authDetail: "",
  accountFacts: [],
  capabilities: caps,
  nexusCapabilities: caps,
  models,
  installCommands: [],
  loginCommand: null,
  docsUrl: "",
  license: "",
  eligibility: "",
  checkedAt: "",
});

describe("on-device classifier", () => {
  it("classifies common goals", () => {
    expect(classifyDomain("Build a website for sleeping. To track your sleep.")[0].domain).toBe("webapp");
    expect(classifyDomain("landing page for my chess club with events")[0].domain).toBe("website");
    expect(classifyDomain("the build fails with a type error")[0].domain).toBe("fix");
    expect(classifyDomain("snake game with keyboard controls")[0].domain).toBe("game");
  });
  it("probabilities sum to 1", () => {
    const r = classifyDomain("anything at all");
    expect(r.reduce((a, b) => a + b.p, 0)).toBeCloseTo(1, 5);
  });
  it("skips questions the goal already answers", () => {
    expect(detectSlots("a dark themed site with photos built in react")).toEqual(expect.arrayContaining(["look", "images", "tech"]));
    const a = analyzeGoal("Build a dark sleep tracker web app in React that saves to localStorage");
    const slots = a.questions.map((q) => q.slot);
    expect(slots).not.toContain("look");
    expect(slots).not.toContain("tech");
    expect(slots).not.toContain("data");
    expect(a.questions.length).toBeLessThanOrEqual(5);
  });
  it("detects image wishes", () => {
    expect(wantsImages({ images: "Yes, generate custom images" }, "x")).toBe(true);
    expect(wantsImages({ images: "No images" }, "generate images")).toBe(false);
    expect(wantsImages({}, "use AI images for the hero")).toBe(true);
  });
});

describe("brief decisions", () => {
  it("adds the user's answers", () => {
    const b = buildBrief("Build a sleep tracker", { decisions: [{ q: "What look do you want?", a: "Dark and calm" }] });
    expect(b.brief).toContain("## Decisions from the user");
    expect(b.brief).toContain("- What look do you want: Dark and calm");
  });
});

describe("team planner", () => {
  const claude = agent("claude-code", "coding-cli", ["edits-project", "resume"], ["opus"]);
  const codex = agent("codex", "coding-cli", ["edits-project", "images", "resume"]);
  const ollama = agent("ollama", "local-runtime", ["local-models"], ["llama3.2:3b"]);
  const base = { goal: "sleep tracker", brief: "## Goal\nsleep tracker.", domain: "webapp" as const, lightModel: "llama3.2:3b", claudeModel: null };

  it("gives each job to the best agent", () => {
    const { steps } = planSwarm({ ...base, answers: { images: "Yes, generate custom images" }, agents: [claude, codex, ollama] });
    const by = Object.fromEntries(steps.map((s, i) => [s.role, { ...s, i }]));
    expect(by.assets.agentId).toBe("codex");
    expect(by.plan.agentId).toBe("ollama");
    expect(by.copy.agentId).toBe("ollama");
    expect(by.build.agentId).toBe("claude-code");
    expect(by.build.afterIndexes.sort()).toEqual([by.assets.i, by.plan.i, by.copy.i].sort());
    expect(by.build.shareWorktreeOfIndex).toBe(by.assets.i);
    expect(by.review.agentId).toBe("codex");
    expect(steps[0].role).toBe("assets");
  });
  it("says so when no agent can make images", () => {
    const r = planSwarm({ ...base, answers: { images: "Yes, generate custom images" }, agents: [claude, ollama] });
    expect(r.steps.some((s) => s.role === "assets")).toBe(false);
    expect(r.notes.join(" ")).toMatch(/no signed-in agent here can generate/);
    expect(r.steps.find((s) => s.role === "build")!.brief).toMatch(/SVG/);
  });
  it("returns nothing without an editor", () => {
    expect(planSwarm({ ...base, answers: {}, agents: [ollama] }).steps).toEqual([]);
  });
});

describe("codex args", () => {
  const input = { sessionId: "s", brief: "do it", cwd: "/p", concise: "normal" as const, model: null, skills: [] };
  it("maps permissions to sandbox modes, never bypass flags", () => {
    const rw = buildCodexArgs({ ...input, permissions: { editFiles: true, runShell: false, network: false, isolate: true } });
    expect(rw.slice(0, 5)).toEqual(["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write"]);
    expect(rw.join(" ")).not.toMatch(/dangerously|network_access/);
    const ro = buildCodexArgs({ ...input, permissions: { editFiles: false, runShell: false, network: false, isolate: false } });
    expect(ro).toContain("read-only");
    const net = buildCodexArgs({ ...input, permissions: { editFiles: true, runShell: false, network: true, isolate: true } });
    expect(net).toContain("sandbox_workspace_write.network_access=true");
    const res = buildCodexArgs({ ...input, resumeNativeId: "t1", permissions: { editFiles: true, runShell: false, network: false, isolate: true } });
    expect(res.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(res).toContain("t1");
  });
});
