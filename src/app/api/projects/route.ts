import { connection } from "next/server";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { addProject, listProjects, validateProjectPath } from "@/runtime/workspace";

export async function GET() {
  await connection();
  return Response.json({ projects: listProjects() });
}

export async function POST(req: Request) {
  const b = await body<{ path?: string }>(req);
  if (!b?.path) return bad("Choose a folder.");
  const v = validateProjectPath(b.path);
  if (!v.ok) return bad(v.error);
  const p = addProject(v.path);
  audit("project.add", p.path);
  return Response.json({ project: p });
}
