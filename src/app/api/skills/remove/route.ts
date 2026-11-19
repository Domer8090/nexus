import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { getDb } from "@/runtime/db";
import { remove } from "@/runtime/skills/cli";
import { getProject } from "@/runtime/workspace";

const schema = z.object({ name: z.string(), scope: z.enum(["project", "global"]), projectId: z.string().nullable().optional(), confirm: z.literal(true) });

export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad("Confirm the removal first.");
  const proj = p.data.projectId ? getProject(p.data.projectId) : null;
  if (p.data.scope === "project" && !proj) return bad("Select the project the skill is installed in.");
  const r = await remove(p.data.name, p.data.scope, proj?.path ?? null);
  getDb().prepare("INSERT INTO skill_installs (skill_id, project_id, scope, agent, action, at) VALUES (?, ?, ?, ?, ?, ?)").run(p.data.name, proj?.id ?? null, p.data.scope, "all", r.ok ? "remove" : "remove-failed", new Date().toISOString());
  audit("skill.remove", `${p.data.name} scope=${p.data.scope} ok=${r.ok}`);
  if (!r.ok) return bad(r.output || "The Skills CLI could not remove it.", 500);
  return Response.json({ ok: true, output: r.output });
}
