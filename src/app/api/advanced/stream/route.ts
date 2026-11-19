import { bus } from "@/runtime/sessions";
import type { AgentEvent, Session } from "@/lib/types";

/**
 * One server-sent event stream for every pane, so four panes don't use up the browser's
 * six connections per host. Live only: panes load their backlog from /api/advanced/log.
 */
export async function GET(req: Request) {
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      };
      const onEvent = (e: AgentEvent) => send("agent", e);
      const onRaw = (r: unknown) => send("raw", r);
      const onSession = (s: Session) => send("session", s);
      bus.on("event", onEvent);
      bus.on("raw", onRaw);
      bus.on("session", onSession);
      const ping = setInterval(() => send("ping", Date.now()), 15_000);
      cleanup = () => {
        clearInterval(ping);
        bus.off("event", onEvent);
        bus.off("raw", onRaw);
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
