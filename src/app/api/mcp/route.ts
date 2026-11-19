import { connection } from "next/server";
import { listMcp, MCP_CATALOG, planAdd } from "@/runtime/mcp";
import { getProject } from "@/runtime/workspace";

export async function GET(req: Request) {
  await connection();
  const u = new URL(req.url);
  const proj = u.searchParams.get("projectId") ? getProject(u.searchParams.get("projectId")!) : null;
  const r = await listMcp(proj?.path ?? process.cwd(), u.searchParams.get("force") === "1");
  return Response.json({ ...r, catalog: MCP_CATALOG.map((c) => ({ ...c, plan: proj ? planAdd(c.id, proj.path) : null })), projectPath: proj?.path ?? null });
}
