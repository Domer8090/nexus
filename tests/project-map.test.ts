import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildMap, purpose, symbols } from "@/runtime/project-map";

describe("project map", () => {
  it("lists exported names per language", () => {
    expect(symbols("a.ts", "export function go() {}\nexport const X = 1\nexport default class Y {}\nconst hidden = 2")).toEqual(["go", "X", "Y"]);
    expect(symbols("a.py", "def run():\n  pass\nclass Thing:\n  pass")).toEqual(["run", "Thing"]);
    expect(symbols("README.md", "# Title\n## Setup\n### deep")).toEqual(["Title", "Setup"]);
  });
  it("reads a leading doc comment", () => {
    expect(purpose('import x from "y";\n\n/**\n * Sorts failures into kinds.\n */')).toBe("Sorts failures into kinds.");
    expect(purpose("const a = 1")).toBeNull();
  });
  it("maps a folder, skipping node_modules and lockfiles", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-map-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "demo", scripts: { dev: "vite" }, dependencies: { react: "19" } }));
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src/app.ts"), "/** The app entry. */\nexport function start() {}\n");
    fs.mkdirSync(path.join(dir, "node_modules/x"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules/x/i.js"), "export const no = 1");
    fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
    const m = await buildMap(dir);
    expect(m.text).toContain("- name: demo");
    expect(m.text).toContain("`app.ts` 3L — The app entry. [start]");
    expect(m.text).not.toContain("node_modules");
    expect(m.text).not.toContain("package-lock");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
