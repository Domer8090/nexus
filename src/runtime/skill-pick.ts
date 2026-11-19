import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { localJson } from "./intake";

/**
 * Picks the installed skills that fit a task. Two stages, both on this machine:
 *   1. a keyword ranker narrows every installed skill to the 12 closest by name and description;
 *   2. the light local model chooses up to 3 of those and says why.
 * The model can only choose from the list it is given; anything else is dropped.
 */

export type LocalSkill = { name: string; description: string; scope: "project" | "global"; dir: string };

const ROOTS = (project: string | null) => [
  ...(project ? [{ dir: path.join(project, ".claude/skills"), scope: "project" as const }, { dir: path.join(project, ".agents/skills"), scope: "project" as const }] : []),
  { dir: path.join(os.homedir(), ".claude/skills"), scope: "global" as const },
  { dir: path.join(os.homedir(), ".agents/skills"), scope: "global" as const },
];

function frontmatter(file: string): { name?: string; description?: string } {
  try {
    const head = fs.readFileSync(file, "utf8").slice(0, 4000);
    const m = head.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const get = (k: string) => m[1].match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
    return { name: get("name"), description: get("description") };
  } catch {
    return {};
  }
}

/** Every skill folder with a SKILL.md that Claude Code or Codex would load for this project. */
export function localSkills(project: string | null): LocalSkill[] {
  const out = new Map<string, LocalSkill>();
  for (const r of ROOTS(project)) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(r.dir);
    } catch {
      continue;
    }
    for (const n of names) {
      const file = path.join(r.dir, n, "SKILL.md");
      if (!fs.existsSync(file)) continue;
      const fm = frontmatter(file);
      const name = (fm.name || n).trim();
      if (!out.has(name)) out.set(name, { name, description: (fm.description ?? "").slice(0, 400), scope: r.scope, dir: path.join(r.dir, n) });
    }
  }
  return [...out.values()];
}

const STOP = new Set("the a an and or for to of in on with by is are be it this that use when any your you from as at into via do not".split(" "));
// Crude stemming so "animations" matches "animation" and "tests" matches "test".
const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ions|ion|es|s)$/, "") : w);
const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)).map(stem);

/** What a skill or task produces, for media that only fit their own kind of work. */
const MEDIA: Record<string, RegExp> = {
  video: /\b(video|videos|reel|reels|footage|vlog|b-roll|broll|subtitles?|captions?|remotion|hyperframes|ffmpeg|timeline|davinci|seedance|tiktok|youtube)\b/i,
  "3d": /\b(3d|blender|mesh|meshes|keyframes?|render(ing)? engine|cycles|eevee)\b/i,
  audio: /\b(music|audio|sound|voice|podcast|dubbing|stems)\b/i,
};
const media = (text: string) => Object.entries(MEDIA).filter(([, re]) => re.test(text)).map(([k]) => k);

/**
 * Keyword overlap between the task and each skill's name and description (name counts double).
 * A skill for a medium (video, 3D, audio) is only a candidate when the task is about that medium.
 */
export function rankSkills(task: string, skills: LocalSkill[], k = 12): LocalSkill[] {
  const t = new Set(words(task));
  const taskMedia = media(task);
  return skills
    .filter((s) => {
      const m = media(`${s.name.replace(/-/g, " ")} ${s.description}`);
      return !m.length || m.some((x) => taskMedia.includes(x));
    })
    .map((s) => {
      const nameHits = words(s.name.replace(/[-:]/g, " ")).filter((w) => t.has(w)).length;
      const descHits = new Set(words(s.description).filter((w) => t.has(w))).size;
      return { s, score: nameHits * 2 + descHits };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.s);
}

export async function pickSkills(model: string, task: string, candidates: LocalSkill[]): Promise<{ name: string; why: string }[]> {
  if (!candidates.length) return [];
  const system =
    "You choose which installed agent skills help a coding agent with a task. A skill applies only when the task produces the same kind of thing the skill is for: a video skill fits only a video task, a 3D skill only a 3D task, a website skill a website. Shared words like 'animation' or 'design' are not enough. Choose at most 3, only from the list. Choosing none is better than a wrong one. Give a reason under 15 words. Reply in JSON.";
  const prompt = `Task: """${task.slice(0, 1500)}"""\n\nFirst decide what the task produces (for example a website, an API, a video). Then pick.\n\nInstalled skills:\n${candidates.map((c) => `- ${c.name}: ${c.description.slice(0, 220)}`).join("\n")}`;
  const out = await localJson<{ picks?: { name?: string; why?: string }[] }>(
    model,
    system,
    prompt,
    { type: "object", properties: { picks: { type: "array", items: { type: "object", properties: { name: { type: "string" }, why: { type: "string" } }, required: ["name", "why"] } } }, required: ["picks"] },
    45_000,
  );
  const names = new Map(candidates.map((c) => [c.name.toLowerCase(), c.name]));
  const seen = new Set<string>();
  const picks: { name: string; why: string }[] = [];
  for (const p of out.picks ?? []) {
    const real = names.get(String(p.name ?? "").trim().toLowerCase());
    if (!real || seen.has(real)) continue;
    seen.add(real);
    picks.push({ name: real, why: String(p.why ?? "").trim().slice(0, 140) || "Fits the task" });
    if (picks.length >= 3) break;
  }
  return picks;
}
