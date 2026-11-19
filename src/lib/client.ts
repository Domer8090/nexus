"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

/** JSON fetch against the local runtime. Errors become ApiError with the server's plain message. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? (init?.body ? "POST" : "GET"),
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("Can't reach the Nexus runtime. Is `npm run dev` still running?", "offline", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error?.message ?? `Request failed (${res.status}).`, data?.error?.code ?? "http", res.status);
  return data as T;
}

/** Loads a resource, optionally polling. Keeps the last good value while reloading. */
export function useApi<T>(path: string | null, opts: { interval?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    if (!opts.interval) return;
    const t = window.setInterval(load, opts.interval);
    return () => window.clearInterval(t);
  }, [load, opts.interval]);
  return { data, error, loading, reload: load, setData };
}

/** Per-browser UI preference only (selected project id, view toggles). Never secrets. */
export function usePref<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`nexus.ui.${key}`);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw != null) setV(JSON.parse(raw));
    } catch {}
  }, [key]);
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        window.localStorage.setItem(`nexus.ui.${key}`, JSON.stringify(next));
      } catch {}
    },
    [key],
  );
  return [v, set] as const;
}

export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function fmtNum(n: number | undefined | null) {
  if (n == null) return "Unavailable";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}
