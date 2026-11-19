import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** Nexus keeps its own data under ~/.nexus (override with NEXUS_HOME). Never inside a user project. */
export function nexusHome() {
  const dir = process.env.NEXUS_HOME?.trim() || path.join(os.homedir(), ".nexus");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function worktreeRoot() {
  const dir = path.join(nexusHome(), "worktrees");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function homeDir() {
  return os.homedir();
}

/** Show paths with ~ instead of the home folder. */
export function tildify(p: string) {
  const h = os.homedir();
  return p === h ? "~" : p.startsWith(h + path.sep) ? "~" + p.slice(h.length) : p;
}
