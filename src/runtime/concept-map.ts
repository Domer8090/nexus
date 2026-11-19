import fs from "node:fs";
import path from "node:path";
import { LOCK, MAP_FILE, SKIP_DIRS, TEXT, listFiles, purpose, symbols } from "./project-map";
import { listEvents, listSessions } from "./sessions";
import { touchOf, type Touch } from "@/lib/touch";

/**
 * Data for the Advanced map: the project's files grouped by folder (size, what each defines, its
 * relative imports) and, for recent sessions, the files each agent read and edited, in order.
 * Everything comes from the files on disk and the recorded events; nothing is estimated.
 */

export type MapFile = { path: string; dir: string; lines: number; purpose: string | null; symbols: string[]; imports: string[]; added?: boolean; binary?: boolean };
export type MapAgent = { sessionId: string; agentId: string; title: string; status: string; cwd: string; touches: Touch[] };

const MAX_FILES = 300;
const IMPORT = /(?:import\s[^"']*?from\s*|import\s*\(|require\s*\(|import\s+)["'](\.{1,2}\/[^"']+)["']/g;
const EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", "/index.ts", "/index.tsx", "/index.js"];

function resolveImport(from: string, spec: string, known: Set<string>): string | null {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  for (const e of EXT) if (known.has(base + e)) return base + e;
  return null;
}

export async function conceptMap(projectPath: string, projectId: string): Promise<{ files: MapFile[]; agents: MapAgent[]; truncated: boolean }> {
  const all = (await listFiles(projectPath)).filter((f) => !f.endsWith(MAP_FILE) && !LOCK.test(f) && !f.split("/").some((seg) => SKIP_DIRS.has(seg))).sort();
  const truncated = all.length > MAX_FILES;
  const picked = all.slice(0, MAX_FILES);
  const known = new Set(picked);
  const files: MapFile[] = [];
  for (const f of picked) {
    const abs = path.join(projectPath, f);
    let lines = 0;
    let binary = false;
    let what: string | null = null;
    let syms: string[] = [];
    const imports: string[] = [];
    try {
      const st = fs.statSync(abs);
      if (!st.isFile()) continue;
      if (TEXT.test(f) && st.size < 400_000) {
        const src = fs.readFileSync(abs, "utf8");
        lines = src.split("\n").length;
        what = purpose(src);
        syms = symbols(f, src).slice(0, 8);
        for (const m of src.matchAll(IMPORT)) {
          const r = resolveImport(f, m[1], known);
          if (r && r !== f && !imports.includes(r)) imports.push(r);
        }
        // HTML pages pull in scripts and styles by relative path.
        for (const m of src.matchAll(/(?:src|href)=["'](?!https?:|\/\/|#|data:)\.?\/?([^"'?#]+)["']/g)) {
          const r = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
          if (known.has(r) && r !== f && !imports.includes(r)) imports.push(r);
        }
      } else {
        binary = true;
        lines = Math.max(1, Math.round(st.size / 4000));
      }
    } catch {
      continue;
    }
    files.push({ path: f, dir: path.posix.dirname(f) === "." ? "" : path.posix.dirname(f), lines, purpose: what, symbols: syms, imports, ...(binary ? { binary } : {}) });
  }

  const agents: MapAgent[] = [];
  const sessions = listSessions({ projectId, limit: 30 });
  const order = [...sessions.filter((s) => ["running", "starting"].includes(s.status)), ...sessions.filter((s) => !["running", "starting"].includes(s.status))].slice(0, 8);
  for (const s of order) {
    const touches = listEvents(s.id)
      .map((e) => touchOf(e, s.cwd))
      .filter((t): t is Touch => !!t && t.file !== MAP_FILE)
      .slice(-40);
    if (!touches.length && !["running", "starting"].includes(s.status)) continue;
    agents.push({ sessionId: s.id, agentId: s.agentId, title: s.title, status: s.status, cwd: s.cwd, touches });
    // Files an agent created in its worktree are on the map too, marked as new.
    for (const t of touches) {
      if (!known.has(t.file) && files.length < MAX_FILES + 40) {
        known.add(t.file);
        files.push({ path: t.file, dir: path.posix.dirname(t.file) === "." ? "" : path.posix.dirname(t.file), lines: 20, purpose: null, symbols: [], imports: [], added: true });
      }
    }
  }
  return { files, agents, truncated };
}
