import { bad } from "@/lib/api";
import { bus, getSession, listEvents } from "@/runtime/sessions";
import type { AgentEvent, Session } from "@/lib/types";

/** Server-sent events: backlog after ?after=, then live events and session updates. */
export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[id]/events">) {
  const { id } = await ctx.params;
  if (!getSession(id)) return bad("Session not found.", 404);
  const after = Number(new URL(req.url).searchParams.get("after") ?? 0) || 0;
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };
      for (const e of listEvents(id, after)) send("agent", e);
      send("session", getSession(id));
      const onEvent = (e: AgentEvent) => send("agent", e);
      const onSession = (s: Session) => s.id === id && send("session", s);
      bus.on(`events:${id}`, onEvent);
      bus.on("session", onSession);
      const ping = setInterval(() => send("ping", Date.now()), 15_000);
      cleanup = () => {
        clearInterval(ping);
        bus.off(`events:${id}`, onEvent);
        bus.off("session", onSession);
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" } });
}
