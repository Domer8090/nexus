import { bad } from "@/lib/api";
import { getSession, listEvents, rawLines } from "@/runtime/sessions";

/** Backlog for one terminal pane: Nexus events plus the raw output lines still in memory. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!getSession(id)) return bad("Session not found.", 404);
  return Response.json({ events: listEvents(id).slice(-2000), raw: rawLines(id) });
}
