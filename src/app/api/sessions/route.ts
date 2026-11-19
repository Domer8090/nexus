import { connection } from "next/server";
import { listSessions, runningCount } from "@/runtime/sessions";

export async function GET(req: Request) {
  await connection();
  const projectId = new URL(req.url).searchParams.get("projectId") ?? undefined;
  return Response.json({ sessions: listSessions({ projectId, limit: 100 }), running: runningCount() });
}
