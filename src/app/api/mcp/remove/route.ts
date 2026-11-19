import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { removeMcp } from "@/runtime/mcp";
import { getProject } from "@/runtime/workspace";

export async function POST(req: Request) {
  const b = await body<{ name?: string; projectId?: string; confirm?: boolean }>(req);
  if (!b?.confirm) return bad("Confirm the removal first.");
  const proj = b.projectId ? getProject(b.projectId) : null;
  if (!proj || !b.name) return bad("Select a project.");
  const r = await removeMcp(b.name, proj.path);
  audit("mcp.remove", `${b.name} project=${proj.path} ok=${r.ok}`);
  if (!r.ok) return bad(r.output || "Claude Code could not remove the server.", 500);
  return Response.json(r);
}
