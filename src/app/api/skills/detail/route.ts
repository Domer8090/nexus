import { connection } from "next/server";
import { bad } from "@/lib/api";
import { parseSkillId } from "@/runtime/skills/cli";
import { skillDetail } from "@/runtime/skills/github";

export async function GET(req: Request) {
  await connection();
  const u = new URL(req.url);
  const id = u.searchParams.get("id") ?? "";
  if (!parseSkillId(id)) return bad("Invalid skill id. Expected owner/repo@skill.");
  return Response.json(await skillDetail(id, u.searchParams.get("force") === "1"));
}
