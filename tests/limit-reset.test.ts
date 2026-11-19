import { describe, expect, it } from "vitest";
import { classifyFailure } from "@/lib/failure";
import { parseReset } from "@/lib/limit-reset";

// 2026-11-18 20:00 in Los Angeles (UTC-8) is 2026-11-19 04:00 UTC.
const now = Date.UTC(2026, 10, 19, 4, 0);

describe("limit reset", () => {
  it("reads Claude Code's reset time in its own time zone", () => {
    const msg = "You've hit your 5-hour limit · resets 11:40pm (America/Los_Angeles)";
    expect(classifyFailure(msg)).toBe("limit");
    expect(new Date(parseReset(msg, now)!).toISOString()).toBe("2026-11-19T07:41:00.000Z");
  });

  it("rolls over to tomorrow when the time already passed today", () => {
    expect(new Date(parseReset("resets 7am (America/Los_Angeles)", now)!).toISOString()).toBe("2026-11-19T15:01:00.000Z");
  });

  it("reads Codex's relative wait", () => {
    expect(parseReset("You've hit your usage limit. Try again in 2 hours 13 minutes.", now)).toBe(now + (133 * 60 + 30) * 1000);
  });

  it("returns null when the message doesn't say", () => {
    expect(parseReset("Rate limited.", now)).toBeNull();
  });
});
