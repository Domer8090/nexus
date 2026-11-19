import { connection } from "next/server";
import { bad } from "@/lib/api";
import { getSession, listEvents } from "@/runtime/sessions";

export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const s = getSession(id);
  if (!s) return bad("Session not found.", 404);
  return Response.json({ session: s, events: listEvents(id) });
}
