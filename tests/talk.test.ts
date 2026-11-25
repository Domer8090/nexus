import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { timeContext } from "@/lib/modes";
import { hasVideo, spokenWords, youLines } from "@/lib/ready";
import { PICK_SCRIPT } from "@/runtime/pick-script";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-cp-"));
process.env.NEXUS_HOME = path.join(dir, "home");
const repo = path.join(dir, "repo");
const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@localhost", "-c", "commit.gpgsign=false", ...a], { cwd: repo, encoding: "utf8" });
const write = (f: string, t: string) => {
  fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
  fs.writeFileSync(path.join(repo, f), t);
};
const has = (f: string) => fs.existsSync(path.join(repo, f));
const text = (f: string) => fs.readFileSync(path.join(repo, f), "utf8");

describe("checkpoints", () => {
  beforeAll(() => {
    fs.mkdirSync(repo);
    git("init", "-q", "-b", "main");
    write(".gitignore", "ignored.txt\nNEXUS_MAP.md\n");
    write("a.txt", "one");
    git("add", ".");
    git("commit", "-qm", "start");
  });
  it("puts changed, deleted and new files back, leaves index, branch, ignored and .env files alone, and can be undone", async () => {
    const { takeCheckpoint, restoreCheckpoint, listCheckpoints } = await import("@/runtime/checkpoints");
    write("sub/b [x] é.txt", "keep");
    write(".env", "A=1");
    write("ignored.txt", "i");
    write("NEXUS_MAP.md", "m");
    const good = (await takeCheckpoint(repo, "Build it", "wf_t"))!;
    const head = git("rev-parse", "HEAD");
    write("a.txt", "broken");
    git("add", "a.txt");
    fs.rmSync(path.join(repo, "sub/b [x] é.txt"));
    write("new.txt", "n");
    write(".env", "A=2");
    const staged = git("diff", "--cached", "--name-only");
    await restoreCheckpoint(repo, "wf_t", good.id);
    expect([text("a.txt"), text("sub/b [x] é.txt"), has("new.txt"), text(".env"), text("ignored.txt")]).toEqual(["one", "keep", false, "A=2", "i"]);
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(git("diff", "--cached", "--name-only")).toBe(staged);
    const before = (await listCheckpoints(repo, "wf_t")).find((c) => c.label === "Before going back")!;
    await restoreCheckpoint(repo, "wf_t", before.id);
    expect([text("a.txt"), has("sub/b [x] é.txt"), has("new.txt")]).toEqual(["broken", false, true]);
  });
  it("doesn't save the same version twice", async () => {
    const { takeCheckpoint } = await import("@/runtime/checkpoints");
    expect((await takeCheckpoint(repo, "x", "wf_u"))!.id).toBe((await takeCheckpoint(repo, "y", "wf_u"))!.id);
  });
});

describe("time and readiness", () => {
  const h = { name: "", theme: "", rubric: "", idea: "", endsAt: "2026-11-30T10:00:00.000Z", startedAt: "2026-11-29T10:00:00.000Z", runCommands: true, projectId: null, workflowId: null, endedAt: null };
  const end = Date.parse(h.endsAt);
  it("freezes features late, not early", () => {
    expect(timeContext(h, end - 20 * 3_600_000)).not.toContain("freeze");
    expect(timeContext(h, end - 4 * 3_600_000)).toContain("Feature freeze");
    expect(timeContext(h, end + 1)).toBeNull();
  });
  it("counts what is spoken, and finds unanswered lines and real video links", () => {
    expect(spokenWords("# Title\n(wave) Hello there judges\n```\ncode here\n```\n**YOU:** add names")).toBe(3);
    expect(youLines("**YOU:** names\n- YOU: learned\nAs you: no", null)).toBe(2);
    expect(hasVideo("https://youtu.be/abcdefgh123")).toBe(true);
    expect(hasVideo("http://localhost:3000/video https://youtube.com/")).toBe(false);
  });
  it("ships a picker script that parses", () => {
    expect(() => new Function(PICK_SCRIPT.replace(/<\/?script>/g, ""))).not.toThrow();
  });
});
