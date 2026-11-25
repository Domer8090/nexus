import { afterEach, describe, expect, it, vi } from "vitest";
import { backboardChat } from "@/runtime/backboard";
import { parseExplanation, shareablePatch } from "@/runtime/explain";
import { buildPacket, parseReply, scriptJson } from "@/runtime/help";
import { claimFindings, diffLines, maskSecrets, packageOf, patchFindings } from "@/runtime/proof";
import { isTestCommand } from "@/lib/test-command";
import { agentEnv } from "@/runtime/proc";

const patch = (file: string, lines: string[], head = "") => `diff --git a/${file} b/${file}\n${head}--- a/${file}\n+++ b/${file}\n@@ -1,2 +1,9 @@\n${lines.join("\n")}`;
const kinds = (p: string) => patchFindings(p).map((x) => x.kind);
const ev = (kind: "text" | "tool" | "tool-result" | "file" | "system", text: string) => ({ kind, text });
const AWS = "AKIA" + "ABCDEFGHIJKLMNOP";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("proof checks", () => {
  it("numbers added lines and keeps ones that start with ++", () => {
    expect(diffLines(patch("a.ts", [" x", "+y", "+++i;", "-z"]))).toEqual({ added: [{ n: 2, text: "y" }, { n: 3, text: "++i;" }], removed: ["z"] });
  });
  it("spots weakened tests", () => {
    expect(kinds(patch("a.test.ts", ["+it.skip('x', () => {})"]))).toEqual(["test-weakened"]);
    expect(kinds(patch("a.test.ts", ["-  expect(a).toBe(2);"]))).toEqual(["test-weakened"]);
    expect(kinds(patch("a.test.ts", ["-  expect(a).toBe(2);", "+  expect(a).toBe(3);"]))).toEqual([]);
    expect(kinds(patch("a.test.ts", ["-x"], "deleted file mode 100644\n"))).toEqual(["test-weakened"]);
  });
  it("spots stubs, hidden errors and secrets, but not removed ones", () => {
    expect(kinds(patch("a.ts", ["+// TODO: finish"]))).toEqual(["stub"]);
    expect(kinds(patch("a.ts", ["+try { x() } catch {}"]))).toEqual(["suppressed"]);
    expect(kinds(patch("a.ts", [`+const k = "${AWS}"`]))).toEqual(["secret"]);
    expect(kinds(patch("a.ts", [`-const k = "${AWS}"`]))).toEqual([]);
    expect(kinds(patch("README.md", ["+TODO list app"]))).toEqual([]);
  });
  it("compares test claims with commands", () => {
    expect(claimFindings([ev("text", "All tests pass.")]).items[0].level).toBe("bad");
    expect(claimFindings([ev("text", "I couldn't confirm the tests pass.")]).items).toEqual([]);
    expect(claimFindings([ev("tool", "Bash: npm test"), ev("text", "All tests pass.")]).items).toEqual([]);
    expect(claimFindings([ev("tool", "Shell: npm test"), ev("tool-result", "Command exited 1"), ev("text", "Tests pass.")]).items[0].level).toBe("bad");
    expect(claimFindings([ev("tool", "Bash: npm test"), ev("file", "a.ts")]).items[0].text).toContain("out of date");
    expect(claimFindings([ev("tool", "Read: vitest.config.ts"), ev("text", "Tests pass.")]).items).toHaveLength(1);
    expect(claimFindings([ev("system", "Check npm run test failed")]).items).toHaveLength(1);
  });
  it("uses the full command's fact and the matching result", () => {
    const t = { kind: "tool" as const, text: "Bash: cd a && sed …", data: { test: true, id: "t1" } };
    expect(claimFindings([t, { kind: "tool-result", text: "Tool error", data: { id: "other" } }, ev("text", "All tests pass.")]).items).toEqual([]);
    expect(claimFindings([t, { kind: "tool-result", text: "Tool error", data: { id: "t1" } }, ev("text", "All tests pass.")]).items[0].level).toBe("bad");
    expect(claimFindings([ev("tool", "Bash: cd a && sed …"), ev("text", "All tests pass.")]).items[0].level).toBe("warn");
  });
  it("tells running tests from mentioning them", () => {
    expect(["npm test", "cd a && npx vitest run | tail", "npm run -s test", "node --test"].every(isTestCommand)).toBe(true);
    expect(["cat vitest.config.ts", "npm i -D jest", "grep -r pytest .", "npm run build"].some(isTestCommand)).toBe(false);
  });
  it("reads package names", () => {
    expect(["react/jsx", "@a/b/c", "./x", "@/lib", "node:fs", "fs/promises", "#x"].map(packageOf)).toEqual(["react", "@a/b", null, null, null, null, null]);
  });
});

describe("sharing", () => {
  it("removes secrets and secret files before anything leaves", () => {
    expect(maskSecrets(`+k="${AWS}"`)).not.toContain(AWS);
    expect(maskSecrets("+-----BEGIN PRIVATE KEY-----\n+abc\n+-----END PRIVATE KEY-----")).not.toContain("abc");
    expect(shareablePatch(patch(".env.local", ["+A=hello"])).get(".env.local")).toContain("not shared");
  });
  it("can't break out of the page's script", () => {
    const evil = "</script><img src=x onerror=alert(1)>";
    expect(scriptJson(evil)).not.toContain("<");
    const html = buildPacket({ id: "h", project: evil, task: evil, ask: evil, explanation: null, proof: { items: [] }, files: [{ path: evil, status: "added", additions: 1, deletions: 0, patch: evil }] });
    expect(html).not.toContain("<img");
    const js = html.split("<script>")[1].split("</script>")[0];
    expect(() => new Function(js)).not.toThrow();
  });
  it("accepts only replies to this change", () => {
    const r = (o: object) => JSON.stringify({ format: "nexus-reply/v1", id: "h1", from: "Sam", verdict: "good", overall: "Nice", notes: [], ...o });
    expect(parseReply(`here you go: ${r({})}`, "h1").from).toBe("Sam");
    expect(() => parseReply(r({ id: "h2" }), "h1")).toThrow("different change");
    expect(() => parseReply(r({ verdict: "run rm" }), "h1")).toThrow("incomplete");
    expect(() => parseReply("hi", "h1")).toThrow("isn't a Nexus reply");
  });
});

describe("Backboard", () => {
  it("sends the key only in the header and reads the answer", async () => {
    vi.stubEnv("BACKBOARD_API_KEY", "bb-test");
    const f = vi.fn<(u: string, i: RequestInit) => Promise<Response>>(async () => Response.json({ content: "{}", model_provider: "openai", model_name: "m" }));
    vi.stubGlobal("fetch", f);
    expect(await backboardChat("s", "p")).toEqual({ text: "{}", model: "openai/m" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://app.backboard.io/api/threads/messages");
    expect(new Headers(init.headers).get("x-api-key")).toBe("bb-test");
    expect(String(init.body)).not.toContain("bb-test");
    expect(agentEnv().BACKBOARD_API_KEY).toBeUndefined();
  });
  it("explains a bad key and a missing key", async () => {
    vi.stubEnv("BACKBOARD_API_KEY", "");
    await expect(backboardChat("s", "p")).rejects.toThrow("Add BACKBOARD_API_KEY");
    vi.stubEnv("BACKBOARD_API_KEY", "x");
    vi.stubGlobal("fetch", async () => Response.json({ detail: "Invalid" }, { status: 401 }));
    await expect(backboardChat("s", "p")).rejects.toThrow("refused the API key");
  });
  it("reads fenced JSON and rejects partial answers", () => {
    expect(parseExplanation('```json\n{"summary":"a","how":["b"]}\n```').quiz).toEqual([]);
    expect(() => parseExplanation('{"summary":"a"}')).toThrow("left parts out");
  });
});
