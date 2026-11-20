import { describe, expect, it } from "vitest";
import { mentionedPaths, scopeFlags, splitPatch } from "@/runtime/review";
import { parseRateLimits, windowName } from "@/runtime/agents/codex-limits";
import { levelOf, resetsAt } from "@/runtime/limits";
import type { FileDiff } from "@/runtime/workspace";
import { leanArgs } from "@/runtime/agents/claude";

const f = (path: string, extra: Partial<FileDiff> = {}): FileDiff => ({ path, status: "modified", additions: 5, deletions: 2, binary: false, ...extra });
const kinds = (task: string, file: FileDiff) => scopeFlags(task, [file])[0].flags.map((x) => x.kind);

describe("scope guard", () => {
  it("reads file and folder names from the task", () => {
    expect(mentionedPaths("Fix the button in src/components/nav.tsx and update index.html, see v1.2.3 on example.com")).toEqual(["src/components/nav.tsx", "index.html"]);
  });

  it("flags files outside the files the task names", () => {
    const task = "Change the header colour in src/components/header.tsx";
    expect(kinds(task, f("src/components/header.tsx"))).toEqual([]);
    expect(kinds(task, f("src/components/footer.tsx"))).toEqual([]); // same folder
    expect(kinds(task, f("src/lib/db.ts"))).toContain("outside");
  });

  it("doesn't guess scope when the task names no files", () => {
    expect(kinds("Make the page feel faster", f("src/lib/db.ts"))).toEqual([]);
  });

  it("flags deletions, dependencies, settings and big edits", () => {
    expect(kinds("x", f("old.js", { status: "deleted" }))).toContain("deleted");
    expect(kinds("x", f("package.json"))).toContain("dependencies");
    expect(kinds("x", f(".github/workflows/ci.yml"))).toContain("settings");
    expect(kinds("x", f("a.ts", { additions: 250, deletions: 90 }))).toContain("large");
    expect(kinds("x", f("a.ts", { additions: 3, deletions: 120 }))).toContain("removes");
  });

  it("splits a patch per file", () => {
    const p = splitPatch("diff --git a/a.ts b/a.ts\n+one\ndiff --git a/b.ts b/b.ts\n-two");
    expect([...p.keys()]).toEqual(["a.ts", "b.ts"]);
    expect(p.get("b.ts")).toContain("-two");
  });
});

describe("Codex usage limits", () => {
  it("reads the newest rate_limits block from Codex's session log", () => {
    const line = (pct: number) => JSON.stringify({ timestamp: "2026-11-18T20:40:00Z", type: "event_msg", payload: { type: "token_count", rate_limits: { primary: { used_percent: pct, window_minutes: 300, resets_at: 1797562693 }, secondary: { used_percent: 12, window_minutes: 10080, resets_at: 1797900000 }, plan_type: "plus", rate_limit_reached_type: null } } });
    const r = parseRateLimits(`${line(40)}\n{"type":"other"}\n${line(91)}\n`);
    expect(r?.plan).toBe("plus");
    expect(r?.quota.map((q) => [q.window, q.utilization])).toEqual([["5-hour", 0.91], ["7-day", 0.12]]);
    expect(r?.quota[0].resetsAt).toBe(new Date(1797562693000).toISOString());
  });

  it("returns null when Codex recorded no limits", () => {
    expect(parseRateLimits('{"type":"event_msg","payload":{"type":"token_count","rate_limits":null}}')).toBeNull();
  });

  it("names windows", () => {
    expect([windowName(300), windowName(10080), windowName(43200), windowName(120)]).toEqual(["5-hour", "7-day", "30-day", "2-hour"]);
  });

  it("warns at 80% and stops at 100% or a rejected window", () => {
    expect(levelOf([{ window: "5-hour", utilization: 0.5 }])).toBe("ok");
    expect(levelOf([{ window: "5-hour", utilization: 0.8 }])).toBe("near");
    expect(levelOf([{ window: "5-hour", utilization: 1 }])).toBe("out");
    expect(levelOf([{ window: "7-day", utilization: 0.4, status: "rejected" }])).toBe("out");
  });
});

describe("resetsAt", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  it("returns the latest reset among full windows", () => {
    const at = resetsAt(
      {
        windows: [
          { window: "5-hour", utilization: 1, resetsAt: "2026-11-19T14:00:00Z", status: "rejected" },
          { window: "7-day", utilization: 1, resetsAt: "2026-11-21T09:00:00Z", status: "rejected" },
          { window: "30-day", utilization: 0.4, resetsAt: "2026-12-01T00:00:00Z", status: "allowed" },
        ],
      },
      now,
    );
    expect(at).toBe(Date.parse("2026-11-21T09:00:00Z"));
  });
  it("returns null when no reset time is known or it has passed", () => {
    expect(resetsAt({ windows: [{ window: "7-day", utilization: 1, status: "rejected" }] }, now)).toBeNull();
    expect(resetsAt({ windows: [{ window: "7-day", utilization: 1, resetsAt: "2026-11-19T11:00:00Z" }] }, now)).toBeNull();
  });
});

describe("leanArgs", () => {
  it("drops MCP, plugins and skills for a step without skills", () => {
    expect(leanArgs({ cwd: "/nonexistent-nexus-dir", skills: [] })).toEqual(["--strict-mcp-config", "--disable-slash-commands", "--setting-sources", "project,local"]);
  });
  it("keeps user settings and skills when the step picked skills", () => {
    expect(leanArgs({ cwd: "/nonexistent-nexus-dir", skills: ["frontend-design"] })).toEqual(["--strict-mcp-config"]);
  });
});
