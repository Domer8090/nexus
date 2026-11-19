import { bad } from "@/lib/api";
import { getSession, listEvents, rawLines } from "@/runtime/sessions";

/** Backlog for one session: Nexus events and the raw output lines still in memory, after the given ids. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get("id") ?? "";
  const after = Number(u.searchParams.get("after") ?? 0) || 0;
  const rawAfter = Number(u.searchParams.get("rawAfter") ?? 0) || 0;
  const session = getSession(id);
  if (!session) return bad("Session not found.", 404);
  return Response.json({ events: listEvents(id, after).slice(-2000), raw: rawLines(id, rawAfter), session });
}
