import path from "node:path";
import { cacheGet, cacheSet } from "../db";
import { run } from "../proc";
import type { CatalogSkill, InstalledSkill } from "@/lib/types";

/**
 * Wrapper around the official Skills CLI (npm package `skills`, pinned 1.9.0).
 * Commands verified with `skills --help`:
 *   skills find <query>                             search skills.sh
 *   skills list --json [-g]                         installed skills
 *   skills add <owner/repo> --skill <name> -a <agent> [-g] -y --json
 *   skills remove <name> -y [-g] [-a <agent>]
 *   skills update <name> -y [-g|-p]
 */

const SKILLS_BIN = () => path.join(process.cwd(), "node_modules", "skills", "bin", "cli.mjs");
const ID_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[A-Za-z0-9_.:-]+$/;
const NAME_RE = /^[A-Za-z0-9_.:-]{1,100}$/;

export function parseSkillId(id: string) {
  if (!ID_RE.test(id)) return null;
  const [repoPart, skill] = [id.slice(0, id.lastIndexOf("@")), id.slice(id.lastIndexOf("@") + 1)];
  const [owner, repo] = repoPart.split("/");
  return { owner, repo, skill };
}

export function validSkillName(name: string) {
  return NAME_RE.test(name);
}

async function skills(args: string[], cwd: string, timeoutMs = 120_000) {
  return run("node", [SKILLS_BIN(), ...args], { cwd, timeoutMs });
}

function stripAnsi(s: string) {
  return s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

/** Parses `skills find` output lines: "owner/repo@skill 1.2K installs" + "└ https://skills.sh/..." */
export function parseFind(out: string, retrievedAt: string): CatalogSkill[] {
  const lines = stripAnsi(out).split("\n").map((l) => l.trim());
  const items: CatalogSkill[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)@(\S+)\s+([\d.]+)([KMB]?)\s+installs?$/);
    if (!m) continue;
    const mult = { "": 1, K: 1e3, M: 1e6, B: 1e9 }[m[5]] ?? 1;
    const url = lines[i + 1]?.match(/https:\/\/skills\.sh\/\S+/)?.[0] ?? `https://skills.sh/${m[1]}/${m[2]}/${m[3]}`;
    items.push({
      id: `${m[1]}/${m[2]}@${m[3]}`,
      owner: m[1],
      repo: m[2],
      skill: m[3],
      installs: Math.round(Number(m[4]) * mult),
      url,
      source: "skills.sh, via `skills find`",
      retrievedAt,
    });
  }
  return items;
}

export async function findSkills(query: string): Promise<{ items: CatalogSkill[]; retrievedAt: string; cached: boolean; error?: string }> {
  const q = query.trim().replace(/[^\w\s.-]/g, " ").slice(0, 80);
  if (!q) return { items: [], retrievedAt: new Date().toISOString(), cached: false };
  const key = `find:${q.toLowerCase()}`;
  const hit = cacheGet<{ items: CatalogSkill[]; retrievedAt: string }>(key, 30 * 60_000);
  if (hit) return { ...hit.value, cached: true };
  const r = await skills(["find", ...q.split(/\s+/)], process.cwd(), 45_000);
  const retrievedAt = new Date().toISOString();
  const items = parseFind(r.stdout, retrievedAt).sort((a, b) => (b.installs ?? -1) - (a.installs ?? -1));
  if (r.code !== 0 && !items.length) return { items: [], retrievedAt, cached: false, error: "The Skills CLI search failed. Check your internet connection." };
  cacheSet(key, { items, retrievedAt });
  return { items, retrievedAt, cached: false };
}

export async function listInstalled(cwd: string | null): Promise<{ project: InstalledSkill[]; global: InstalledSkill[]; error?: string }> {
  const parse = (out: string, scope: "project" | "global"): InstalledSkill[] => {
    try {
      const j = JSON.parse(out) as { name: string; path: string; agents?: string[]; source?: string | null; sourceType?: string | null; status?: string | null }[];
      return j.map((x) => ({ name: x.name, path: x.path, scope, agents: x.agents ?? [], source: x.source ?? null, sourceType: x.sourceType ?? null, status: x.status ?? null }));
    } catch {
      return [];
    }
  };
  const [p, gl] = await Promise.all([cwd ? skills(["list", "--json"], cwd, 30_000) : Promise.resolve(null), skills(["list", "--json", "-g"], process.cwd(), 30_000)]);
  return { project: p ? parse(p.stdout, "project") : [], global: parse(gl.stdout, "global") };
}

export type InstallPlan = { args: string[]; cwd: string; preview: string; destination: string };

export function planInstall(id: string, scope: "project" | "global", agent: string, projectPath: string | null): InstallPlan | { error: string } {
  const p = parseSkillId(id);
  if (!p) return { error: "Invalid skill id." };
  if (!/^[a-z0-9-]+$/.test(agent)) return { error: "Invalid agent." };
  if (scope === "project" && !projectPath) return { error: "Select a project for a project-scoped install." };
  const args = ["add", `${p.owner}/${p.repo}`, "--skill", p.skill, "--agent", agent, "-y", "--json"];
  if (scope === "global") args.splice(1, 0, "-g");
  // Observed with Skills CLI 1.9.0: a Claude Code-only install goes to .claude/skills; other agents share .agents/skills.
  const dir = agent === "claude-code" ? ".claude/skills" : ".agents/skills";
  const destination = scope === "global" ? `~/${dir}/${p.skill}` : `${projectPath}/${dir}/${p.skill}`;
  return { args, cwd: scope === "project" ? projectPath! : process.cwd(), preview: `npx skills ${args.join(" ")}`, destination };
}

export async function install(plan: InstallPlan) {
  const r = await skills(plan.args, plan.cwd, 180_000);
  let json: unknown = null;
  try {
    json = JSON.parse(r.stdout.slice(r.stdout.indexOf("[")) || "null");
  } catch {}
  const failed = Array.isArray(json) && json.some((x: { status?: string }) => x.status === "failed");
  return { ok: r.code === 0 && !failed, output: stripAnsi(r.stdout + r.stderr).slice(-4000), json };
}

export async function remove(name: string, scope: "project" | "global", cwd: string | null) {
  if (!validSkillName(name)) return { ok: false, output: "Invalid skill name." };
  const args = ["remove", name, "-y"];
  if (scope === "global") args.push("-g");
  const r = await skills(args, scope === "project" && cwd ? cwd : process.cwd(), 60_000);
  return { ok: r.code === 0, output: stripAnsi(r.stdout + r.stderr).slice(-3000) };
}

export async function updateSkill(name: string, scope: "project" | "global", cwd: string | null) {
  if (!validSkillName(name)) return { ok: false, output: "Invalid skill name." };
  const args = ["update", name, "-y", scope === "global" ? "-g" : "-p"];
  const r = await skills(args, scope === "project" && cwd ? cwd : process.cwd(), 180_000);
  return { ok: r.code === 0, output: stripAnsi(r.stdout + r.stderr).slice(-3000) };
}
