import { describe, expect, it } from "vitest";
import { resumeCommand } from "@/runtime/advanced";
import type { Session } from "@/lib/types";

const base = { cwd: "/Users/me/my app", nativeSessionId: "abc-123" } as Session;

describe("advanced resume command", () => {
  it("uses each agent's documented resume flag and quotes the folder", () => {
    expect(resumeCommand({ ...base, agentId: "claude-code" })).toBe("cd '/Users/me/my app' && claude --resume abc-123");
    expect(resumeCommand({ ...base, agentId: "codex" })).toBe("cd '/Users/me/my app' && codex resume abc-123");
  });

  it("offers nothing when the agent has no session to resume", () => {
    expect(resumeCommand({ ...base, agentId: "ollama" })).toBeNull();
    expect(resumeCommand({ ...base, agentId: "claude-code", nativeSessionId: null })).toBeNull();
  });
});
