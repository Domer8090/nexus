import { describe, expect, it } from "vitest";
import { canHandOff, classifyFailure } from "@/lib/failure";

describe("classifyFailure", () => {
  it("recognises Claude Code's expired sign-in", () => {
    const msg = "Failed to authenticate: this login reached its time limit and cannot be renewed. Run `claude auth login` to sign in again, or use `claude setup-token` and set CLAUDE_CODE_OAUTH_TOKEN for unattended jobs";
    expect(classifyFailure(msg)).toBe("sign-in");
    expect(canHandOff("sign-in")).toBe(true);
  });
  it("recognises a missing sign-in from pre-flight", () => {
    expect(classifyFailure("Codex CLI is not signed in. Not logged in.")).toBe("sign-in");
  });
  it("recognises usage limits", () => {
    expect(classifyFailure("You've hit your usage limit. Try again in 3 hours.")).toBe("limit");
    expect(classifyFailure("HTTP 429 Too Many Requests")).toBe("limit");
  });
  it("recognises a missing agent or model", () => {
    expect(classifyFailure("Ollama has no model pulled, so it is not available.")).toBe("missing");
    expect(classifyFailure("spawn claude ENOENT")).toBe("missing");
  });
  it("leaves real build errors alone, so they are not handed off", () => {
    expect(classifyFailure("TypeError: cannot read properties of undefined")).toBe("other");
    expect(canHandOff("other")).toBe(false);
    expect(classifyFailure(null)).toBe("other");
  });
});

describe("network drops", () => {
  it("sorts dropped connections apart from other failures", () => {
    expect(classifyFailure("getaddrinfo ENOTFOUND api.anthropic.com")).toBe("network");
    expect(classifyFailure("stream disconnected before completion")).toBe("network");
    expect(classifyFailure("TypeError: fetch failed")).toBe("network");
    expect(classifyFailure("Syntax error in index.html")).toBe("other");
  });
});
