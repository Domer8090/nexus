import { connection } from "next/server";
import { getDb } from "@/runtime/db";
import { listInstalled } from "@/runtime/skills/cli";
import { getProject } from "@/runtime/workspace";

export async function GET(req: Request) {
  await connection();
  const pid = new URL(req.url).searchParams.get("projectId");
  const proj = pid ? getProject(pid) : null;
  const r = await listInstalled(proj?.path ?? null);
  const history = getDb().prepare("SELECT skill_id, project_id, scope, agent, source_url, commit_sha, license, review, installed_path, action, at FROM skill_installs ORDER BY id DESC LIMIT 200").all();
  return Response.json({ ...r, history, projectPath: proj?.path ?? null });
}
