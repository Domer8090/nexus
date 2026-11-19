import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { getDb } from "@/runtime/db";
import { install, listInstalled, planInstall } from "@/runtime/skills/cli";
import { skillDetail } from "@/runtime/skills/github";
import { getProject } from "@/runtime/workspace";

const schema = z.object({
  id: z.string(),
  scope: z.enum(["project", "global"]),
  agent: z.enum(["claude-code", "codex", "gemini-cli", "opencode"]),
  projectId: z.string().nullable().optional(),
  approve: z.literal(true),
  acknowledgeReview: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

/**
 * Plans (dryRun) or performs a skill install through the official Skills CLI.
 * The plan shows the exact command and destination; install needs explicit approval,
 * and a second acknowledgement when the review is not clean. Blocked skills never install.
 */
export async function POST(req: Request) {
  const raw = await body<Record<string, unknown>>(req);
  const p = schema.safeParse({ ...raw, approve: raw?.dryRun ? true : raw?.approve });
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Approve the install first.");
  const proj = p.data.projectId ? getProject(p.data.projectId) : null;
  const plan = planInstall(p.data.id, p.data.scope, p.data.agent, proj?.path ?? null);
  if ("error" in plan) return bad(plan.error);
  const detail = await skillDetail(p.data.id);
  if (p.data.dryRun) return Response.json({ plan, review: detail.review, license: detail.license, sourcePath: detail.sourcePath, commit: detail.commit, error: detail.error });
  if (detail.review.outcome === "blocked") return bad("This skill is blocked by the security review and can't be installed from Nexus.", 403, "blocked");
  if (detail.review.outcome !== "reviewed" && !p.data.acknowledgeReview) return bad("This skill needs review. Confirm you checked the findings.", 400, "needs_ack");
  const r = await install(plan);
  // Record where the CLI actually put it, not just where we expected.
  const after = r.ok ? await listInstalled(proj?.path ?? null) : null;
  const actual = after ? [...(p.data.scope === "project" ? after.project : after.global)].find((x) => x.name.toLowerCase() === plan.args[plan.args.indexOf("--skill") + 1].toLowerCase())?.path : undefined;
  getDb()
    .prepare("INSERT INTO skill_installs (skill_id, project_id, scope, agent, source_url, commit_sha, license, review, installed_path, action, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(p.data.id, proj?.id ?? null, p.data.scope, p.data.agent, `${detail.repoUrl}/blob/${detail.commit ?? detail.ref}/${detail.sourcePath ?? ""}`, detail.commit, detail.license, detail.review.outcome, actual ?? plan.destination, r.ok ? "install" : "install-failed", new Date().toISOString());
  audit("skill.install", `${p.data.id} scope=${p.data.scope} agent=${p.data.agent} ok=${r.ok}`);
  if (!r.ok) return bad(`The Skills CLI reported a failure:\n${r.output}`, 500, "cli_failed");
  return Response.json({ ok: true, output: r.output, plan });
}
