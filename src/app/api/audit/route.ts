import { connection } from "next/server";
import { recentAudit } from "@/runtime/audit";

export async function GET() {
  await connection();
  return Response.json({ entries: recentAudit(200) });
}
