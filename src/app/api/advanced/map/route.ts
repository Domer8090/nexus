import { connection } from "next/server";
import { bad } from "@/lib/api";
import { conceptMap } from "@/runtime/concept-map";
import { getProject } from "@/runtime/workspace";

/** The project map for the Advanced workspace: files by folder, imports, and where each agent has been. */
export async function GET(req: Request) {
  await connection();
  const id = new URL(req.url).searchParams.get("projectId") ?? "";
  const project = getProject(id);
  if (!project) return bad("Project not found.", 404);
  return Response.json(await conceptMap(project.path, project.id));
}
