import { connection } from "next/server";
import { detectAll } from "@/runtime/agents/registry";
import { clearWhichCache } from "@/runtime/proc";

export async function GET(req: Request) {
  await connection();
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (force) clearWhichCache();
  return Response.json({ agents: await detectAll(force) });
}
