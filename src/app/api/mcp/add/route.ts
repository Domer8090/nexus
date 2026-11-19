import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { addMcp } from "@/runtime/mcp";
import { getProject } from "@/runtime/workspace";

export async function POST(req: Request) {
  const b = await body<{ id?: string; projectId?: string; confirm?: boolean }>(req);
  if (!b?.confirm) return bad("Approve the change first.");
  const proj = b.projectId ? getProject(b.projectId) : null;
  if (!proj || !b.id) return bad("Select a project.");
  const r = await addMcp(b.id, proj.path);
  audit("mcp.add", `${b.id} project=${proj.path} ok=${r.ok}`);
  if (!r.ok) return bad(r.output || "Claude Code could not add the server.", 500);
  return Response.json(r);
}
