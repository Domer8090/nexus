import { connection } from "next/server";
import { findSkills } from "@/runtime/skills/cli";

export async function GET(req: Request) {
  await connection();
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json(await findSkills(q));
}
