import { cacheGet, cacheSet } from "../db";
import { parseSkillId } from "./cli";
import { isScript, reviewFiles } from "./review";
import type { SkillDetail } from "@/lib/types";

/**
 * Reads a skill's public source from GitHub (REST API + raw files), unauthenticated.
 * No user data or tokens are sent. Results are cached locally for 6 hours.
 */

const UA = { "user-agent": "nexus-local-skill-inspector", accept: "application/vnd.github+json" };
const MAX_FILES = 40;
const MAX_SIZE = 200_000;

async function gh<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
  if (r.status === 403 || r.status === 429) throw new Error("GitHub's unauthenticated rate limit was reached. Try again later.");
  if (r.status === 404) throw new Error("Not found on GitHub.");
  if (!r.ok) throw new Error(`GitHub returned ${r.status}.`);
  return (await r.json()) as T;
}

export function parseFrontmatter(md: string): Record<string, unknown> {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, unknown> = {};
  let key: string | null = null;
  for (const line of m[1].split("\n")) {
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      key = top[1];
      const v = top[2].trim();
      out[key] = v === "" || v === ">-" || v === ">" || v === "|" ? "" : v.replace(/^["']|["']$/g, "");
    } else if (key && /^\s+/.test(line)) {
      const prev = out[key];
      const t = line.trim();
      if (t.startsWith("- ")) out[key] = Array.isArray(prev) ? [...prev, t.slice(2)] : [t.slice(2)];
      else if (typeof prev === "string") out[key] = (prev ? prev + " " : "") + t;
      else out[key] = prev ?? t;
    }
  }
  return out;
}

function kind(p: string): SkillDetail["files"][number]["kind"] {
  if (/(^|\/)SKILL\.md$/i.test(p)) return "skill";
  if (isScript(p)) return "script";
  if (/\.(md|txt|rst)$/i.test(p)) return "doc";
  if (/\.(json|ya?ml|toml|lock)$/i.test(p)) return "config";
  if (/\.(png|jpe?g|gif|svg|webp|woff2?|ttf|mp4|zip)$/i.test(p)) return "asset";
  return "other";
}

const TEXT = /\.(md|txt|rst|sh|bash|zsh|py|js|mjs|cjs|ts|tsx|jsx|rb|pl|ps1|bat|cmd|json|ya?ml|toml|html|css|svg|xml|ini|cfg|env|example)$|(^|\/)[^.]+$/i;

export async function skillDetail(id: string, force = false): Promise<SkillDetail> {
  const p = parseSkillId(id);
  if (!p) throw new Error("Invalid skill id.");
  const key = `detail:${id.toLowerCase()}`;
  if (!force) {
    const hit = cacheGet<SkillDetail>(key, 6 * 3600_000);
    if (hit) return hit.value;
  }
  const retrievedAt = new Date().toISOString();
  const base: SkillDetail = {
    id,
    ...p,
    name: p.skill,
    description: "",
    repoUrl: `https://github.com/${p.owner}/${p.repo}`,
    sourcePath: null,
    ref: null,
    commit: null,
    license: null,
    stars: null,
    pushedAt: null,
    lastCommitAt: null,
    files: [],
    skillMd: null,
    frontmatter: {},
    hooks: false,
    allowedTools: [],
    mcpServers: [],
    dependencies: [],
    review: { outcome: "not-reviewed", findings: [], checked: [], notChecked: ["Source could not be read"], reviewedAt: retrievedAt, filesScanned: 0 },
    retrievedAt,
  };
  try {
    const repo = await gh<{ default_branch: string; license: { spdx_id: string | null; name: string } | null; stargazers_count: number; pushed_at: string; html_url: string }>(
      `https://api.github.com/repos/${p.owner}/${p.repo}`,
    );
    base.repoUrl = repo.html_url;
    base.ref = repo.default_branch;
    base.license = repo.license ? (repo.license.spdx_id && repo.license.spdx_id !== "NOASSERTION" ? repo.license.spdx_id : repo.license.name) : null;
    base.stars = repo.stargazers_count;
    base.pushedAt = repo.pushed_at;

    const tree = await gh<{ sha: string; tree: { path: string; type: string; size?: number }[]; truncated: boolean }>(
      `https://api.github.com/repos/${p.owner}/${p.repo}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`,
    );
    base.commit = tree.sha;
    const skillFiles = tree.tree.filter((t) => t.type === "blob" && /(^|\/)SKILL\.md$/i.test(t.path));
    const dirOf = (f: string) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "");
    let chosen = skillFiles.find((f) => dirOf(f.path).split("/").pop()?.toLowerCase() === p.skill.toLowerCase());
    const raw = (path: string) =>
      fetch(`https://raw.githubusercontent.com/${p.owner}/${p.repo}/${tree.sha}/${path.split("/").map(encodeURIComponent).join("/")}`, { signal: AbortSignal.timeout(15_000) }).then((r) =>
        r.ok ? r.text() : Promise.reject(new Error(`raw ${r.status}`)),
      );
    if (!chosen) {
      for (const f of skillFiles.slice(0, 12)) {
        const md = await raw(f.path);
        if (String(parseFrontmatter(md).name ?? "").toLowerCase() === p.skill.toLowerCase()) {
          chosen = f;
          break;
        }
      }
    }
    if (!chosen && skillFiles.length === 1) chosen = skillFiles[0];
    if (!chosen) throw new Error(`No SKILL.md for "${p.skill}" was found in ${p.owner}/${p.repo}.`);
    const dir = dirOf(chosen.path);
    base.sourcePath = chosen.path;
    const inDir = tree.tree.filter((t) => t.type === "blob" && (dir === "" ? true : t.path.startsWith(dir + "/")));
    // A root-level skill in a big repo: limit to the SKILL.md plus files beside it.
    const scoped = dir === "" ? inDir.filter((t) => !t.path.includes("/") || t.path.startsWith("scripts/")) : inDir;
    base.files = scoped.map((t) => ({ path: dir ? t.path.slice(dir.length + 1) : t.path, size: t.size ?? 0, kind: kind(t.path) }));

    try {
      const commits = await gh<{ sha: string; commit: { committer: { date: string } } }[]>(
        `https://api.github.com/repos/${p.owner}/${p.repo}/commits?path=${encodeURIComponent(dir || chosen.path)}&per_page=1`,
      );
      base.lastCommitAt = commits[0]?.commit.committer.date ?? null;
    } catch {}

    const toFetch = scoped.slice(0, MAX_FILES);
    const contents = await Promise.all(
      toFetch.map(async (t) => {
        const rel = dir ? t.path.slice(dir.length + 1) : t.path;
        if ((t.size ?? 0) > MAX_SIZE || !TEXT.test(t.path)) return { path: rel, content: null, size: t.size ?? 0 };
        try {
          return { path: rel, content: await raw(t.path), size: t.size ?? 0 };
        } catch {
          return { path: rel, content: null, size: t.size ?? 0 };
        }
      }),
    );
    // Some repos license each skill folder separately instead of the repository.
    if (!base.license) {
      const lic = contents.find((c) => /^LICEN[CS]E(\.(txt|md))?$/i.test(c.path) && c.content);
      const text = lic?.content ?? "";
      const known: [RegExp, string][] = [[/Apache License,?\s+Version 2\.0/i, "Apache-2.0"], [/MIT License|Permission is hereby granted, free of charge/i, "MIT"], [/BSD 3-Clause|Redistribution and use in source and binary forms/i, "BSD"], [/Mozilla Public License/i, "MPL-2.0"], [/GNU GENERAL PUBLIC LICENSE/i, "GPL"], [/all rights reserved|proprietary/i, "Proprietary"]];
      const hit = known.find(([re]) => re.test(text));
      if (lic) base.license = hit ? `${hit[1]} (from ${lic.path} in the skill folder)` : `See ${lic.path} in the skill folder`;
    }
    const md = contents.find((c) => /(^|\/)SKILL\.md$/i.test(c.path) && !c.path.includes("/"))?.content ?? (await raw(chosen.path));
    base.skillMd = md;
    const fm = parseFrontmatter(md);
    base.frontmatter = fm;
    base.name = String(fm.name ?? p.skill);
    base.description = String(fm.description ?? "").slice(0, 1200);
    base.hooks = "hooks" in fm || /^hooks:/m.test(md.split("---")[1] ?? "");
    const at = fm["allowed-tools"] ?? fm.allowed_tools;
    base.allowedTools = Array.isArray(at) ? at.map(String) : typeof at === "string" && at ? at.split(/[,\s]+/).filter(Boolean) : [];
    base.mcpServers = Array.from(new Set((md.match(/\bmcp__([a-z0-9_-]+)__/gi) ?? []).map((m) => m.split("__")[1])));
    const pkg = contents.find((c) => c.path === "package.json")?.content;
    if (pkg) {
      try {
        const j = JSON.parse(pkg) as { dependencies?: Record<string, string> };
        base.dependencies = Object.keys(j.dependencies ?? {});
      } catch {}
    }
    const req = contents.find((c) => /requirements\.txt$/.test(c.path))?.content;
    if (req) base.dependencies.push(...req.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
    base.review = reviewFiles(contents, { hasHooks: base.hooks, allowedTools: base.allowedTools, license: base.license, totalFiles: scoped.length });
    if (tree.truncated) base.review.notChecked.push("GitHub truncated the repository tree, so some files may be missing");
  } catch (e) {
    base.error = (e as Error).message;
  }
  if (!base.error) cacheSet(key, base);
  return base;
}
