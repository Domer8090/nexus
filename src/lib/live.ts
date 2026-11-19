"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentEvent, Session } from "./types";

/**
 * One live connection per browser tab for every session on screen.
 *
 * Browsers allow six HTTP/1.1 connections per host. A server-sent event stream holds one open for
 * as long as it lives, so a stream per step (five steps on a run page, plus a lane) used all six,
 * and every click, page load and API call then waited behind them. All views subscribe here
 * instead; the stream closes a few seconds after the last subscriber leaves.
 */

export type RawLine = { n: number; at: string; stream: "out" | "err"; line: string };
type Listener = {
  onEvent?: (e: AgentEvent) => void;
  onRaw?: (r: RawLine & { sessionId: string }) => void;
  onSession?: (s: Session) => void;
  /** The stream dropped and came back: reload anything that may have been missed. */
  onReconnect?: () => void;
  onState?: (live: boolean) => void;
};

const listeners = new Set<Listener>();
let es: EventSource | null = null;
let closeTimer: number | null = null;
let dropped = false;

function ensure() {
  if (closeTimer) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (es) return;
  es = new EventSource("/api/advanced/stream");
  es.addEventListener("open", () => {
    for (const l of listeners) l.onState?.(true);
    if (dropped) for (const l of listeners) l.onReconnect?.();
    dropped = false;
  });
  es.addEventListener("error", () => {
    dropped = true;
    for (const l of listeners) l.onState?.(false);
  });
  es.addEventListener("agent", (m) => {
    const e = JSON.parse((m as MessageEvent).data) as AgentEvent;
    for (const l of listeners) l.onEvent?.(e);
  });
  es.addEventListener("raw", (m) => {
    const r = JSON.parse((m as MessageEvent).data);
    for (const l of listeners) l.onRaw?.(r);
  });
  es.addEventListener("session", (m) => {
    const s = JSON.parse((m as MessageEvent).data) as Session;
    for (const l of listeners) l.onSession?.(s);
  });
}

export function subscribeLive(l: Listener): () => void {
  listeners.add(l);
  ensure();
  return () => {
    listeners.delete(l);
    if (!listeners.size && !closeTimer) {
      closeTimer = window.setTimeout(() => {
        closeTimer = null;
        if (listeners.size) return;
        es?.close();
        es = null;
      }, 5000);
    }
  };
}

type Backlog = { events: AgentEvent[]; raw: RawLine[]; session: Session | null };

export async function loadBacklog(id: string, after = 0): Promise<Backlog> {
  const r = await fetch(`/api/advanced/log?id=${encodeURIComponent(id)}&after=${after}`, { cache: "no-store" });
  if (!r.ok) throw new Error("Could not load this session's output.");
  return (await r.json()) as Backlog;
}

/** Events and live session state for one session, from the shared stream plus its stored backlog. */
export function useSessionStream(id: string) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const last = useRef(0);
  const pending = useRef<AgentEvent[]>([]);
  useEffect(() => {
    last.current = 0;
    pending.current = [];
    // A different session: start from an empty view.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEvents([]);
    setSession(null);
    let alive = true;
    // Batch live events into one render every 120 ms instead of one render per line.
    const flush = window.setInterval(() => {
      if (!pending.current.length) return;
      const add = pending.current;
      pending.current = [];
      setEvents((cur) => [...cur, ...add]);
    }, 120);
    const take = (e: AgentEvent) => {
      if (e.id <= last.current) return;
      last.current = e.id;
      pending.current.push(e);
    };
    const backfill = async () => {
      try {
        const b = await loadBacklog(id, last.current);
        if (!alive) return;
        b.events.forEach(take);
        if (b.session) setSession(b.session);
      } catch {}
    };
    const off = subscribeLive({
      onEvent: (e) => e.sessionId === id && take(e),
      onSession: (s) => s.id === id && setSession(s),
      onReconnect: backfill,
    });
    void backfill();
    return () => {
      alive = false;
      window.clearInterval(flush);
      off();
    };
  }, [id]);
  return { events, session };
}
