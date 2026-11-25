import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { audit } from "./audit";
import { newId } from "./ids";
import { run } from "./proc";
import { isRepo } from "./workspace";

/**
 * Snapshots of a run's folder after every step, kept as git objects under refs/nexus/checkpoints.
 * They use a throwaway index, so the person's branch, index and stashes are never touched. Restoring
 * always snapshots the present first, so a restore can itself be undone. Ignored and .env files are
 * left out, both when saving and when restoring.
 */

export type Checkpoint = { id: string; sha: string; label: string; at: string };
const REF = "refs/nexus/checkpoints";
const who = ["-c", "user.name=Nexus", "-c", "user.email=nexus@localhost", "-c", "commit.gpgsign=false"];

async function git(cwd: string, args: string[], env?: Record<string, string>, input?: string) {
  const r = await run("git", args, { cwd, timeoutMs: 60_000, env, input, maxBytes: 32 * 1024 * 1024 });
  if (r.code !== 0) throw new Error(r.stderr.trim().slice(0, 300) || "git failed");
  return r.stdout.trim();
}

/** Stages every file git doesn't ignore, except .env files and Nexus's own map. */
export async function stageAll(root: string, env?: Record<string, string>) {
  const all = (await git(root, ["ls-files", "-co", "--exclude-standard", "-z"])).split("\0");
  // Entries that end in a slash are repositories inside this one; they are not ours to save.
  const mine = Array.from(new Set(all)).filter((f) => f && !f.endsWith("/") && !/(^|\/)\.env[^/]*$/.test(f) && f !== "NEXUS_MAP.md");
  if (mine.length) await git(root, ["update-index", "--add", "--remove", "-z", "--stdin"], env, mine.join("\0") + "\0");
}

/** The whole folder as one tree, whatever subfolder of the repository it is. */
async function rootOf(cwd: string) {
  return git(cwd, ["rev-parse", "--show-toplevel"]);
}

export async function takeCheckpoint(cwd: string, label: string, scope: string): Promise<Checkpoint | null> {
  if (!(await isRepo(cwd))) return null;
  const root = await rootOf(cwd);
  const index = path.join(os.tmpdir(), `nexus-index-${newId("x")}`);
  try {
    const env = { GIT_INDEX_FILE: index };
    await stageAll(root, env);
    const tree = await git(root, ["write-tree"], env);
    const last = (await listCheckpoints(cwd, scope))[0];
    if (last && (await git(root, ["rev-parse", `${last.sha}^{tree}`])) === tree) return last;
    const sha = await git(root, [...who, "commit-tree", tree, "-m", label.replace(/\s+/g, " ").slice(0, 120)]);
    const id = newId("cp");
    await git(root, ["update-ref", `${REF}/${scope}/${id}`, sha]);
    return { id, sha, label, at: new Date().toISOString() };
  } finally {
    fs.rmSync(index, { force: true });
  }
}

export async function listCheckpoints(cwd: string, scope: string): Promise<Checkpoint[]> {
  if (!(await isRepo(cwd))) return [];
  const out = await git(cwd, ["for-each-ref", "--sort=-committerdate", "--format=%(refname)%09%(objectname)%09%(committerdate:iso-strict)%09%(contents:subject)", `${REF}/${scope}`]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [ref, sha, at, ...label] = l.split("\t");
      return { id: ref.split("/").pop()!, sha, at, label: label.join(" ") };
    });
}

export async function restoreCheckpoint(cwd: string, scope: string, id: string): Promise<{ files: number }> {
  const cp = (await listCheckpoints(cwd, scope)).find((c) => c.id === id);
  if (!cp) throw new Error("That checkpoint is gone.");
  const now = await takeCheckpoint(cwd, "Before going back", scope);
  if (!now) throw new Error("Checkpoints need a git repository.");
  const root = await rootOf(cwd);
  const rows = (await git(root, ["diff", "--no-renames", "--name-status", "-z", cp.sha, now.sha])).split("\0").filter(Boolean);
  let files = 0;
  const back: string[] = [];
  for (let i = 0; i + 1 < rows.length; i += 2) {
    const [st, file] = [rows[i], rows[i + 1]];
    files++;
    if (st !== "A") {
      back.push(file);
      continue;
    }
    // Added since the checkpoint: in the snapshot just taken, so removing it here loses nothing.
    const full = path.resolve(root, file);
    if (full.startsWith(root + path.sep)) fs.rmSync(full, { force: true });
  }
  for (let i = 0; i < back.length; i += 200) await git(root, ["--literal-pathspecs", "restore", `--source=${cp.sha}`, "--worktree", "--", ...back.slice(i, i + 200)]);
  audit("checkpoint.restore", `${scope} ${id} files=${files}`);
  return { files };
}
