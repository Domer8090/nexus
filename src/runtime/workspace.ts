import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { newId } from "./ids";
import { homeDir, worktreeRoot } from "./paths";
import { run } from "./proc";
import type { GitState, Project } from "@/lib/types";

// ---------------- Projects ----------------

const BLOCKED = ["/", "/System", "/usr", "/bin", "/sbin", "/etc", "/private", "/Library", "/Applications"];

/** Projects must be existing folders inside the user's home folder, and not the home folder itself. */
export function validateProjectPath(input: string): { ok: true; path: string } | { ok: false; error: string } {
  const raw = input.trim().replace(/^~(?=$|\/)/, homeDir());
  if (!raw || !path.isAbsolute(raw)) return { ok: false, error: "Enter an absolute path, for example ~/code/my-app." };
  let real: string;
  try {
    real = fs.realpathSync(raw);
  } catch {
    return { ok: false, error: "That folder does not exist." };
  }
  if (!fs.statSync(real).isDirectory()) return { ok: false, error: "That path is a file, not a folder." };
  const home = fs.realpathSync(homeDir());
  if (real === home) return { ok: false, error: "Pick a project folder, not your whole home folder." };
  if (!real.startsWith(home + path.sep) || BLOCKED.includes(real)) return { ok: false, error: "Nexus only opens project folders inside your home folder." };
  if (real.startsWith(fs.realpathSync(worktreeRoot()))) return { ok: false, error: "That is a Nexus worktree, not a project." };
  return { ok: true, path: real };
}

type Row = { id: string; name: string; path: string; added_at: string; last_opened_at: string };
const toProject = (r: Row): Project => ({ id: r.id, name: r.name, path: r.path, addedAt: r.added_at, lastOpenedAt: r.last_opened_at });

export function listProjects(): Project[] {
  return (getDb().prepare("SELECT * FROM projects ORDER BY last_opened_at DESC").all() as Row[]).map(toProject);
}

export function getProject(id: string): Project | null {
  const r = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
  return r ? toProject(r) : null;
}

export function addProject(p: string): Project {
  const existing = getDb().prepare("SELECT * FROM projects WHERE path = ?").get(p) as Row | undefined;
  const now = new Date().toISOString();
  if (existing) {
    getDb().prepare("UPDATE projects SET last_opened_at = ? WHERE id = ?").run(now, existing.id);
    return toProject({ ...existing, last_opened_at: now });
  }
  const proj: Project = { id: newId("prj"), name: path.basename(p), path: p, addedAt: now, lastOpenedAt: now };
  getDb().prepare("INSERT INTO projects (id, name, path, added_at, last_opened_at) VALUES (?, ?, ?, ?, ?)").run(proj.id, proj.name, proj.path, now, now);
  return proj;
}

export function touchProject(id: string) {
  getDb().prepare("UPDATE projects SET last_opened_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

export function removeProject(id: string) {
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
}

/** Lists child folders for the folder picker. Read-only, home folder only. */
export function browse(dir: string) {
  const v = validateBrowse(dir);
  if (!v.ok) return v;
  const entries = fs
    .readdirSync(v.path, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
    .map((d) => ({ name: d.name, path: path.join(v.path, d.name), isRepo: fs.existsSync(path.join(v.path, d.name, ".git")) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 300);
  const home = fs.realpathSync(homeDir());
  return { ok: true as const, path: v.path, parent: v.path === home ? null : path.dirname(v.path), entries };
}

function validateBrowse(dir: string): { ok: true; path: string } | { ok: false; error: string } {
  const raw = (dir || homeDir()).replace(/^~(?=$|\/)/, homeDir());
  try {
    const real = fs.realpathSync(raw);
    const home = fs.realpathSync(homeDir());
    if (real !== home && !real.startsWith(home + path.sep)) return { ok: false, error: "Browsing is limited to your home folder." };
    return { ok: true, path: real };
  } catch {
    return { ok: false, error: "Folder not found." };
  }
}

export function projectScripts(p: string): string[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(p, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    return Object.keys(pkg.scripts ?? {}).filter((s) => /^(test|lint|typecheck|check|build)(:|$)/.test(s));
  } catch {
    return [];
  }
}

// ---------------- Git ----------------

export async function isRepo(cwd: string) {
  const r = await run("git", ["rev-parse", "--is-inside-work-tree"], { cwd, timeoutMs: 5000 });
  return r.code === 0 && r.stdout.trim() === "true";
}

export async function hasCommits(cwd: string) {
  const r = await run("git", ["rev-parse", "--verify", "HEAD"], { cwd, timeoutMs: 5000 });
  return r.code === 0;
}

export async function gitState(cwd: string): Promise<GitState> {
  if (!(await isRepo(cwd))) return { isRepo: false, branch: null, ahead: 0, behind: 0, changes: [], worktrees: [] };
  const s = await run("git", ["status", "--porcelain=v1", "-b", "--untracked-files=all"], { cwd, timeoutMs: 10_000 });
  if (s.code !== 0) return { isRepo: true, branch: null, ahead: 0, behind: 0, changes: [], worktrees: [], error: s.stderr.trim().slice(0, 300) };
  const lines = s.stdout.split("\n").filter(Boolean);
  const head = lines[0]?.startsWith("## ") ? lines.shift()!.slice(3) : "";
  const branch = head.split("...")[0].replace(/^No commits yet on /, "") || null;
  const ahead = Number(head.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(head.match(/behind (\d+)/)?.[1] ?? 0);
  const changes = lines.slice(0, 500).map((l) => ({ status: l.slice(0, 2).trim() || "?", path: l.slice(3) }));
  const w = await run("git", ["worktree", "list", "--porcelain"], { cwd, timeoutMs: 5000 });
  const worktrees: GitState["worktrees"] = [];
  let cur: { path: string; branch: string | null } | null = null;
  for (const l of w.stdout.split("\n")) {
    if (l.startsWith("worktree ")) {
      if (cur) worktrees.push(cur);
      cur = { path: l.slice(9), branch: null };
    } else if (l.startsWith("branch ") && cur) cur.branch = l.slice(7).replace("refs/heads/", "");
  }
  if (cur) worktrees.push(cur);
  return { isRepo: true, branch, ahead, behind, changes, worktrees };
}

/** Creates an isolated worktree for one session, on a new branch from HEAD. */
export async function createWorktree(projectPath: string, sessionId: string): Promise<{ ok: true; path: string; branch: string; base: string } | { ok: false; error: string }> {
  if (!(await isRepo(projectPath))) return { ok: false, error: "Not a git repository." };
  if (!(await hasCommits(projectPath))) return { ok: false, error: "The repository has no commits yet, so there is nothing to branch from." };
  const base = (await run("git", ["rev-parse", "HEAD"], { cwd: projectPath })).stdout.trim();
  const branch = `nexus/${sessionId}`;
  const dir = path.join(worktreeRoot(), `${path.basename(projectPath)}-${sessionId}`);
  const r = await run("git", ["worktree", "add", "-b", branch, dir, base], { cwd: projectPath, timeoutMs: 60_000 });
  if (r.code !== 0) return { ok: false, error: `git worktree add failed: ${r.stderr.trim().slice(0, 300)}` };
  // Reuse installed dependencies so checks can run in the worktree, only when git already ignores them.
  for (const deps of ["node_modules"]) {
    const src = path.join(projectPath, deps);
    if (!fs.existsSync(src)) continue;
    const ignored = await run("git", ["check-ignore", "-q", deps], { cwd: projectPath, timeoutMs: 5000 });
    if (ignored.code === 0) {
      try {
        fs.symlinkSync(src, path.join(dir, deps), "dir");
      } catch {}
    }
  }
  return { ok: true, path: dir, branch, base };
}

export async function removeWorktree(projectPath: string, dir: string, branch: string | null) {
  if (!dir.startsWith(worktreeRoot())) throw new Error("Refusing to remove a folder Nexus did not create.");
  await run("git", ["worktree", "remove", "--force", dir], { cwd: projectPath, timeoutMs: 30_000 });
  if (branch?.startsWith("nexus/")) await run("git", ["branch", "-D", branch], { cwd: projectPath, timeoutMs: 10_000 });
}

export type FileDiff = { path: string; status: "added" | "modified" | "deleted" | "renamed"; additions: number; deletions: number; binary: boolean };

/** Diff of everything in cwd compared with `base` (or HEAD), including new files. */
export async function diff(cwd: string, base: string | null): Promise<{ patch: string; files: FileDiff[]; truncated: boolean } | { error: string }> {
  if (!(await isRepo(cwd))) return { error: "Diff review needs a git repository. Initialize git in this project to review changes." };
  // Make new files visible to diff without staging their contents.
  await run("git", ["add", "--intent-to-add", "--all"], { cwd, timeoutMs: 20_000 });
  const ref = base ?? "HEAD";
  const [numstat, nameStatus, patch] = await Promise.all([
    run("git", ["diff", "--numstat", ref], { cwd, timeoutMs: 20_000 }),
    run("git", ["diff", "--name-status", ref], { cwd, timeoutMs: 20_000 }),
    run("git", ["diff", "--no-color", "--no-ext-diff", ref], { cwd, timeoutMs: 30_000 }),
  ]);
  const statusMap = new Map<string, string>();
  for (const l of nameStatus.stdout.split("\n").filter(Boolean)) {
    const [st, ...rest] = l.split("\t");
    statusMap.set(rest.at(-1)!, st);
  }
  const files: FileDiff[] = numstat.stdout
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [a, d, ...p] = l.split("\t");
      const file = p.join("\t").replace(/^.*=> /, "").replace(/[{}]/g, "");
      const st = statusMap.get(file) ?? "M";
      return {
        path: file,
        status: st.startsWith("A") ? "added" : st.startsWith("D") ? "deleted" : st.startsWith("R") ? "renamed" : "modified",
        additions: a === "-" ? 0 : Number(a),
        deletions: d === "-" ? 0 : Number(d),
        binary: a === "-",
      };
    });
  const max = 400_000;
  return { patch: patch.stdout.slice(0, max), files, truncated: patch.stdout.length > max };
}

/** Applies a session worktree's changes to the project as uncommitted changes. Never commits or pushes. */
export async function applyToProject(worktree: string, base: string, projectPath: string): Promise<{ ok: true; files: number } | { ok: false; error: string }> {
  await run("git", ["add", "--intent-to-add", "--all"], { cwd: worktree, timeoutMs: 20_000 });
  const p = await run("git", ["diff", "--binary", "--no-color", base], { cwd: worktree, timeoutMs: 60_000, maxBytes: 96 * 1024 * 1024 });
  if (!p.stdout.trim()) return { ok: false, error: "There are no changes to apply." };
  const check = await run("git", ["apply", "--check", "--whitespace=nowarn", "-"], { cwd: projectPath, input: p.stdout, timeoutMs: 30_000 });
  if (check.code !== 0) {
    return { ok: false, error: `These changes conflict with the project's current files. Nothing was changed.\n${check.stderr.trim().slice(0, 600)}` };
  }
  const r = await run("git", ["apply", "--whitespace=nowarn", "-"], { cwd: projectPath, input: p.stdout, timeoutMs: 30_000 });
  if (r.code !== 0) return { ok: false, error: r.stderr.trim().slice(0, 600) };
  const files = (p.stdout.match(/^diff --git /gm) ?? []).length;
  return { ok: true, files };
}

/** Files touched by more than one session. */
export function overlaps(changed: { sessionId: string; files: string[] }[]) {
  const owners = new Map<string, string[]>();
  for (const c of changed) for (const f of c.files) owners.set(f, [...(owners.get(f) ?? []), c.sessionId]);
  return [...owners.entries()].filter(([, s]) => s.length > 1).map(([file, sessions]) => ({ file, sessions }));
}
