import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { updateSkill } from "@/runtime/skills/cli";
import { getProject } from "@/runtime/workspace";

const schema = z.object({ name: z.string(), scope: z.enum(["project", "global"]), projectId: z.string().nullable().optional(), confirm: z.literal(true) });

export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad("Confirm the update first.");
  const proj = p.data.projectId ? getProject(p.data.projectId) : null;
  const r = await updateSkill(p.data.name, p.data.scope, proj?.path ?? null);
  audit("skill.update", `${p.data.name} scope=${p.data.scope} ok=${r.ok}`);
  if (!r.ok) return bad(r.output || "Update failed.", 500);
  return Response.json({ ok: true, output: r.output });
}
