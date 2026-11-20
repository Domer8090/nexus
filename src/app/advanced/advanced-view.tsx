"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppWindow, Bell, Copy, FileCode2, NotebookPen, Columns2, ExternalLink, Grid2x2, ImagePlus, Map as MapIcon, MessageSquarePlus, Monitor, RotateCcw, Send, Smartphone, Square, SquareTerminal, Tablet, X } from "lucide-react";
import { api, useApi } from "@/lib/client";
import { startPaper } from "./fly-paper";
import { ConceptMap } from "./concept-map";
import { loadBacklog, subscribeLive, type RawLine } from "@/lib/live";
import { cx } from "@/components/ui";
import { ProjectNotes } from "@/components/project-notes";
import { ReviewChanges } from "@/components/review-changes";
import { useWorkspace } from "@/components/workspace-context";
import type { AgentEvent, Session } from "@/lib/types";

/**
 * Advanced workspace, in the spirit of terminal multiplexers built for agents: vertical tabs for every
 * session, up to four split panes, each pane the agent's live terminal (Nexus events or the raw
 * process output), with the exact command, folder, branch, pid and process tree. Rings mark
 * sessions that need you: failed, or finished since you last looked.
 */

type ProcRow = { pid: number; ppid: number; cpu: number; rssMb: number; elapsed: string; args: string; depth: number };
/** "at 3:40 PM" today, "Nov 21, 3:40 PM" on another day. */
function resetWhen(iso: string) {
  const d = new Date(iso);
  const today = d.toDateString() === new Date().toDateString();
  return today ? `at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : `on ${d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

type Limit = { agentId: string; agentName: string; level: "ok" | "near" | "out"; text: string };
type AdvSession = Session & { pid: number | null; procs: ProcRow[]; resume: string | null };
type Log = { events: AgentEvent[]; raw: RawLine[]; loaded: boolean };
type ViewResp = { url: string | null; entry: string | null; devCommand: string | null; framework: string | null; path: string; version: number; error?: string };
const DEVICES = { desktop: { w: 0, h: 0, icon: Monitor, label: "Desktop" }, tablet: { w: 820, h: 1180, icon: Tablet, label: "iPad" }, phone: { w: 390, h: 844, icon: Smartphone, label: "iPhone" } } as const;
type Device = keyof typeof DEVICES;

const LIVE = ["running", "starting", "queued"];
const LAYOUTS = [1, 2, 4] as const;
const SEEN_KEY = "nexus.advanced.seen";
const LAYOUT_KEY = "nexus.advanced.layout";
const CAP = 3000;

const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = window.localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      window.localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

function elapsed(s: Session, now: number) {
  if (!s.startedAt) return "";
  const ms = (s.endedAt ? Date.parse(s.endedAt) : now) - Date.parse(s.startedAt);
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
}

/** Ticking elapsed time, re-rendering only itself once a second while the session runs. */
function Elapsed({ s }: { s: Session }) {
  const [now, setNow] = useState(() => Date.now());
  const running = !s.endedAt && !!s.startedAt;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  return <>{elapsed(s, now)}</>;
}

function dotClass(s: Session) {
  if (s.status === "running" || s.status === "starting") return "bg-ok live-dot";
  if (s.status === "queued") return "bg-ink-3";
  if (s.status === "failed") return "bg-bad";
  if (s.status === "cancelled") return "bg-ink-3";
  return "bg-[#9ec9f7]";
}

const KIND: Record<string, { mark: string; cls: string }> = {
  tool: { mark: "$", cls: "text-[#9ec9f7]" },
  "tool-result": { mark: "<", cls: "text-[#f5a08b]" },
  file: { mark: "+", cls: "text-ok" },
  text: { mark: " ", cls: "text-ink" },
  thinking: { mark: "~", cls: "text-ink-3 italic" },
  status: { mark: ">", cls: "text-[#caa8f7]" },
  system: { mark: "#", cls: "text-ink-2" },
  usage: { mark: "=", cls: "text-ink-3" },
  stderr: { mark: "!", cls: "text-warn" },
  error: { mark: "x", cls: "text-bad" },
};

function useLogs(sessions: AdvSession[] | undefined) {
  const logs = useRef(new Map<string, Log>());
  const [, setTick] = useState(0);
  const dirty = useRef(false);
  const [liveOk, setLiveOk] = useState(true);
  const statusRef = useRef(new Map<string, string>());
  const [notify, setNotify] = useState(false);

  const log = (id: string) => {
    let l = logs.current.get(id);
    if (!l) {
      l = { events: [], raw: [], loaded: false };
      logs.current.set(id, l);
    }
    return l;
  };

  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);
  const versions = useRef(new Map<string, number>());
  const bump = (id: string) => {
    versions.current.set(id, (versions.current.get(id) ?? 0) + 1);
    dirty.current = true;
  };

  useEffect(() => {
    const off = subscribeLive({
      onState: setLiveOk,
      onEvent: (e) => {
        const l = log(e.sessionId);
        if (l.events.length && l.events[l.events.length - 1].id >= e.id) return;
        l.events.push(e);
        if (l.events.length > CAP) l.events.splice(0, l.events.length - CAP);
        bump(e.sessionId);
      },
      onRaw: (r) => {
        const l = log(r.sessionId);
        if (l.raw.length && l.raw[l.raw.length - 1].n >= r.n) return;
        l.raw.push(r);
        if (l.raw.length > CAP) l.raw.splice(0, l.raw.length - CAP);
        bump(r.sessionId);
      },
      onSession: (s) => {
        const before = statusRef.current.get(s.id);
        statusRef.current.set(s.id, s.status);
        if (before && before !== s.status && (s.status === "completed" || s.status === "failed") && notifyRef.current && typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification(s.status === "failed" ? `${s.title} failed` : `${s.title} finished`, { body: s.error ?? s.summary?.slice(0, 140) ?? s.agentId });
          } catch {}
        }
      },
      // Anything missed while the stream was down: reload the backlog of panes already open.
      onReconnect: () => {
        for (const l of logs.current.values()) l.loaded = false;
        setTick((n) => n + 1);
      },
    });
    // One render for all panes at most every 150 ms, however fast lines arrive.
    const t = setInterval(() => {
      if (dirty.current) {
        dirty.current = false;
        setTick((n) => n + 1);
      }
    }, 150);
    return () => {
      clearInterval(t);
      off();
    };
  }, []);

  useEffect(() => {
    for (const s of sessions ?? []) if (!statusRef.current.has(s.id)) statusRef.current.set(s.id, s.status);
  }, [sessions]);

  const load = useCallback(async (id: string) => {
    const l = log(id);
    if (l.loaded) return;
    l.loaded = true;
    try {
      const d = await loadBacklog(id);
      const ids = new Set(l.events.map((e) => e.id));
      const ns = new Set(l.raw.map((r) => r.n));
      l.events = [...d.events.filter((e) => !ids.has(e.id)), ...l.events].sort((a, b) => a.id - b.id);
      l.raw = [...d.raw.filter((r) => !ns.has(r.n)), ...l.raw].sort((a, b) => a.n - b.n);
      bump(id);
      setTick((n) => n + 1);
    } catch {
      l.loaded = false;
    }
  }, []);

  return { get: (id: string) => logs.current.get(id), version: (id: string) => versions.current.get(id) ?? 0, load, liveOk, notify, setNotify };
}

type PaneProps = {
  s: AdvSession | null;
  log: Log | undefined;
  version: number;
  load: (id: string) => void;
  focused: boolean;
  onFocus: (i: number) => void;
  onClose: (i: number) => void;
  agentName: (id: string) => string;
  index: number;
  onOpen: (i: number, id: string) => void;
  /** One or two panes: room to open the app preview beside the terminal by itself. */
  roomy: boolean;
  /** This session's agent, when it reported being near or at its usage limit. */
  limit: Limit | null;
};

/** Re-render a pane only when its own session or output changed, not on every poll or keystroke elsewhere. */
const Pane = memo(PaneInner, (a, b) => {
  for (const k of ["log", "version", "load", "focused", "onFocus", "onClose", "agentName", "index", "onOpen", "roomy"] as const) if (a[k] !== b[k]) return false;
  if (a.limit?.text !== b.limit?.text) return false;
  return a.s === b.s || (!!a.s && !!b.s && JSON.stringify(a.s) === JSON.stringify(b.s));
});

const WINDOW = 500;

function PaneInner({
  s,
  log,
  load,
  focused,
  onFocus: focusAt,
  onClose: closeAt,
  agentName,
  index,
  onOpen: openAt,
  roomy,
  limit,
}: PaneProps) {
  const { agents, project } = useWorkspace();
  const [reviewing, setReviewing] = useState(false);
  const onFocus = () => focusAt(index);
  const onClose = () => closeAt(index);
  const onOpen = (nid: string) => openAt(index, nid);
  const [more, setMore] = useState(0);
  const [view, setView] = useState<"events" | "raw">("events");
  const [preview, setPreview] = useState<boolean | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [command, setCommand] = useState("");
  const [sending, setSending] = useState(false);
  const isLive = !!s && LIVE.includes(s.status);
  const app = useApi<ViewResp>(s && s.status !== "queued" ? `/api/view?session=${s.id}` : null, { interval: isLive ? 5000 : 0 });
  const appUrl = app.data?.url ?? null;
  // Like a coding agent's preview panel: the app opens beside the terminal once there is one to show.
  const showPreview = preview ?? (roomy && !!(appUrl || app.data?.devCommand));
  const [showProcs, setShowProcs] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const id = s?.id;

  useEffect(() => {
    if (id) load(id);
  }, [id, load]);

  const lines = view === "events" ? log?.events.length ?? 0 : log?.raw.length ?? 0;
  useEffect(() => {
    const el = body.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines, view, id]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      setMsg((e as Error).message);
    }
    setTimeout(() => setMsg(null), 2500);
  };

  const copy = (text: string, ok: string) => act(() => navigator.clipboard.writeText(text), ok);

  const send = async () => {
    if (!s || !command.trim() || sending) return;
    setSending(true);
    try {
      const r = await api<{ session: Session }>(`/api/sessions/${s.id}/action`, { body: { action: "revise", feedback: command.trim() } });
      setCommand("");
      onOpen(r.session.id);
    } catch (e) {
      setMsg((e as Error).message);
      setTimeout(() => setMsg(null), 4000);
    } finally {
      setSending(false);
    }
  };

  if (!s)
    return (
      <section onMouseDown={onFocus} data-pane-focused={focused || undefined} aria-label={`Pane ${index + 1}, empty`} className={cx("flex min-h-0 flex-col items-center justify-center rounded-md border bg-[#0b0b0b] text-[15px] text-ink-3", focused ? "border-[#4c8dff]" : "border-line")}>
        Pick a session on the left to show it here.
      </section>
    );

  const live = LIVE.includes(s.status);
  const cmd = s.command.join(" ");
  // Another signed-in agent that can do this step, for the near-limit offer.
  const moveTo = agents.find(
    (a) =>
      a.id !== s.agentId &&
      a.install === "installed" &&
      (a.auth === "authenticated" || a.auth === "not-required") &&
      (a.kind !== "local-runtime" || a.models.length > 0) &&
      (s.permissions.editFiles ? a.nexusCapabilities.includes("edits-project") : true),
  );
  return (
    <section
      onMouseDown={onFocus}
      data-pane-focused={focused || undefined}
      aria-label={`Pane ${index + 1}: ${s.title}`}
      className={cx("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-[#0b0b0b]", focused ? "border-[#4c8dff] shadow-[0_0_0_1px_#4c8dff]" : s.status === "failed" ? "border-bad" : "border-line")}
    >
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className={cx("size-2 shrink-0 rounded-full", dotClass(s))} aria-hidden />
        <h2 className="min-w-0 truncate text-[15px] font-medium text-ink" title={s.brief.slice(0, 400)}>
          {s.title}
        </h2>
        <span className="shrink-0 font-mono text-[13px] text-ink-3">
          {agentName(s.agentId)}
          {s.model ? ` ${s.model}` : ""}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[13px] text-ink-2">
          {s.status}
          {s.startedAt ? " " : ""}
          {s.startedAt && <Elapsed s={s} />}
          {s.pid ? ` pid ${s.pid}` : ""}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {live ? (
            <IconBtn label="Stop this session" onClick={() => act(() => api(`/api/sessions/${s.id}/action`, { body: { action: "cancel" } }), "Stopping.")}>
              <Square size={14} />
            </IconBtn>
          ) : (s.status === "failed" || s.status === "cancelled") && (
            <IconBtn label="Run this session again" onClick={() => act(() => api(`/api/sessions/${s.id}/action`, { body: { action: "retry" } }), "Queued again.")}>
              <RotateCcw size={14} />
            </IconBtn>
          )}
          {s.permissions.editFiles && !live && ["completed", "applied"].includes(s.status) && (
            <IconBtn label="Review changes" onClick={() => setReviewing(true)} active={reviewing}>
              <FileCode2 size={15} />
            </IconBtn>
          )}
          <IconBtn label={showPreview ? "Hide the app preview" : "Show the app preview"} onClick={() => setPreview(!showPreview)} active={showPreview}>
            <AppWindow size={15} />
          </IconBtn>
          <IconBtn label="Open Terminal in this session's folder" onClick={() => act(() => api("/api/advanced/open", { body: { sessionId: s.id } }), "Opened Terminal.")}>
            <SquareTerminal size={15} />
          </IconBtn>
          <IconBtn label="Close pane" onClick={onClose}>
            <X size={15} />
          </IconBtn>
        </div>
      </header>

      <div className="flex items-center gap-1 border-b border-line px-2 py-1 font-mono text-[13px]">
        {(["events", "raw"] as const).map((v) => (
          <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v} className={cx("whitespace-nowrap rounded px-2 py-0.5", view === v ? "bg-[#1f1f1f] text-ink" : "text-ink-3 hover:text-ink")}>
            {v === "events" ? "Steps" : "Raw output"}
          </button>
        ))}
        <span className="ml-auto min-w-0 truncate text-ink-3" title={s.cwd}>
          {s.worktreeBranch ?? "no branch"} {s.cwd}
        </span>
      </div>

      <div className={cx("flex min-h-0 flex-1", showPreview && "flex-col xl:flex-row")}>
      <div
        ref={body}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[13px] leading-[1.55]"
        role="log"
        aria-live={focused ? "polite" : "off"}
      >
        {lines > WINDOW + more && (
          <button type="button" onClick={() => setMore(more + 1000)} className="mb-2 rounded border border-line px-2 py-0.5 text-ink-3 hover:text-ink">
            Show {Math.min(1000, lines - WINDOW - more)} earlier lines
          </button>
        )}
        {view === "events"
          ? (log?.events ?? []).slice(-(WINDOW + more)).map((e) => {
              const k = KIND[e.kind] ?? KIND.system;
              return (
                <div key={e.id} className={cx("flex gap-2 whitespace-pre-wrap break-words", k.cls)}>
                  <span className="w-3 shrink-0 select-none text-ink-3">{k.mark}</span>
                  <span className="min-w-0">{e.text}</span>
                </div>
              );
            })
          : (log?.raw ?? []).slice(-(WINDOW + more)).map((r) => (
              <div key={r.n} className={cx("whitespace-pre-wrap break-all", r.stream === "err" ? "text-warn" : "text-ink-2")}>
                {r.line}
              </div>
            ))}
        {!lines && <p className="text-ink-3">{view === "raw" ? (s.agentId === "ollama" ? "Ollama runs as a local server, so there is no process output to show. Steps shows its stream." : "No raw output in memory. Nexus keeps it only while it runs, until it restarts.") : "No output yet."}</p>}
        {live && <span className="cursor-blink inline-block h-[1.05em] w-[0.55em] translate-y-[2px] bg-ink-2" aria-hidden />}
      </div>
      {showPreview && <AppPreview view={app.data} loading={app.loading} device={device} setDevice={setDevice} onTerminal={() => act(() => api("/api/advanced/open", { body: { sessionId: s.id } }), "Opened Terminal.")} copy={copy} />}
      </div>

      <footer className="border-t border-line px-3 py-2 font-mono text-[13px]">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-ink-3">cmd</span>
          <code className="min-w-0 flex-1 truncate text-ink-2" title={cmd}>
            {cmd || "Not started yet."}
          </code>
          {cmd && (
            <IconBtn label="Copy command" onClick={() => copy(cmd, "Command copied.")}>
              <Copy size={13} />
            </IconBtn>
          )}
        </div>
        {s.resume && (
          <div className="mt-1 flex items-center gap-2">
            <span className="shrink-0 text-ink-3">resume</span>
            <code className="min-w-0 flex-1 truncate text-ink-2" title={s.resume}>
              {s.resume}
            </code>
            <IconBtn label="Copy resume command" onClick={() => copy(s.resume!, "Resume command copied. Paste it in your terminal.")}>
              <Copy size={13} />
            </IconBtn>
          </div>
        )}
        {s.procs.length > 0 && (
          <div className="mt-1">
            <button type="button" onClick={() => setShowProcs(!showProcs)} aria-expanded={showProcs} className="text-ink-3 hover:text-ink">
              processes ({s.procs.length})
            </button>
            {showProcs && (
              <ul className="mt-1 max-h-28 overflow-y-auto">
                {s.procs.map((p) => (
                  <li key={p.pid} className="flex gap-2 whitespace-nowrap text-ink-2" title={p.args}>
                    <span className="w-14 shrink-0 text-right text-ink-3">{p.pid}</span>
                    <span className="w-12 shrink-0 text-right">{p.cpu.toFixed(1)}%</span>
                    <span className="w-14 shrink-0 text-right">{p.rssMb} MB</span>
                    <span className="min-w-0 truncate" style={{ paddingLeft: `${p.depth * 12}px` }}>
                      {p.depth ? "└ " : ""}
                      {p.args}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {(msg || s.error) && <p className={cx("mt-1 truncate", msg ? "text-ink" : "text-bad")} title={s.error ?? undefined}>{msg ?? s.error}</p>}
        {limit && limit.level !== "ok" && (s.status === "queued" || s.status === "running" || s.status === "starting") && (
          <div className="mt-1 flex items-center gap-2 text-warn">
            <span className="min-w-0 flex-1 truncate" title={limit.text}>
              {limit.text}
            </span>
            {s.status === "queued" && moveTo && (
              <button
                type="button"
                onClick={() => act(() => api(`/api/sessions/${s.id}/action`, { body: { action: "reassign", agentId: moveTo.id } }), `Moved to ${moveTo.displayName}.`)}
                className="shrink-0 rounded border border-line-strong px-2 py-0.5 text-ink hover:bg-[#1f1f1f]"
              >
                Move to {moveTo.displayName}
              </button>
            )}
          </div>
        )}
        {((s.status === "failed" && (s.retryAt || isLimit(s.error))) || (s.status === "queued" && s.retryAt)) && (
          <div className="mt-1 flex items-center gap-2 text-ink-2">
            <span className="min-w-0 flex-1 truncate">
              {s.retryAt
                ? `${s.status === "queued" ? "Starts" : "Runs again"} ${resetWhen(s.retryAt)}, when the limit resets.`
                : "Usage limit hit."}
            </span>
            <button
              type="button"
              onClick={() =>
                act(
                  () => api(`/api/sessions/${s.id}/action`, { body: { action: "wait-reset", wait: !s.retryAt } }),
                  s.status === "queued" ? "Running now." : s.retryAt ? "Won't run again by itself." : "Waiting for the reset.",
                )
              }
              className="shrink-0 rounded border border-line-strong px-2 py-0.5 text-ink hover:bg-[#1f1f1f]"
            >
              {s.status === "queued" ? "Run now" : s.retryAt ? "Don't wait" : "Run when it resets"}
            </button>
          </div>
        )}
      </footer>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 border-t border-line px-3 py-2"
      >
        <span className="font-mono text-[14px] text-ok" aria-hidden>
          ❯
        </span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          disabled={live || sending}
          aria-label={`Tell ${agentName(s.agentId)} what to change next`}
          placeholder={live ? "Working. Stop it to change course, or wait for it to finish." : `Tell ${agentName(s.agentId)} what to change next`}
          className="h-9 min-w-0 flex-1 bg-transparent font-mono text-[14px] text-ink placeholder:text-ink-3 focus:outline-none disabled:opacity-60"
        />
        <IconBtn label="Send to this agent" onClick={() => void send()}>
          <Send size={14} />
        </IconBtn>
      </form>
      {reviewing && <ReviewChanges s={s} open onClose={() => setReviewing(false)} onChanged={() => {}} notify={(m) => { setMsg(m); setTimeout(() => setMsg(null), 4000); }} projectName={project?.name ?? "your project"} />}
    </section>
  );
}

function isLimit(error: string | null) {
  return !!error && /usage limit|rate[ -]?limit|hit your (?:[\w-]+ )?limit|try again (later|in|at)|resets? /i.test(error);
}

function AppPreview({ view, loading, device, setDevice, onTerminal, copy }: { view: ViewResp | null; loading: boolean; device: Device; setDevice: (d: Device) => void; onTerminal: () => void; copy: (t: string, ok: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const d = DEVICES[device];
  const scale = d.w ? Math.min(1, (size.w - 24) / d.w, (size.h - 24) / d.h) : 1;
  return (
    <div className="flex min-h-[260px] min-w-0 flex-1 flex-col border-t border-line xl:border-t-0 xl:border-l">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1 font-mono text-[13px]">
        {(Object.keys(DEVICES) as Device[]).map((k) => {
          const D = DEVICES[k];
          return (
            <IconBtn key={k} label={`Preview as ${D.label}`} onClick={() => setDevice(k)} active={device === k}>
              <D.icon size={14} />
            </IconBtn>
          );
        })}
        <span className="ml-1 min-w-0 flex-1 truncate text-ink-3">{view?.url ? view.entry : view?.framework ?? "App preview"}</span>
        {view?.url && (
          <a href={view.url} target="_blank" rel="noreferrer" aria-label="Open the app in a new tab" title="Open the app in a new tab" className="grid size-7 place-items-center rounded text-ink-3 hover:bg-[#1f1f1f] hover:text-ink">
            <ExternalLink size={14} />
          </a>
        )}
      </div>
      <div ref={box} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-[#141414]">
        {view?.url ? (
          d.w ? (
            <div style={{ width: d.w * scale, height: d.h * scale }} className="overflow-hidden rounded-[22px] border-[6px] border-[#2a2a2a] bg-white shadow-[0_20px_60px_rgb(0_0_0/0.5)]">
              <iframe key={`${view.version}-${device}`} src={view.url} title="App preview" style={{ width: d.w, height: d.h, transform: `scale(${scale})`, transformOrigin: "0 0" }} className="bg-white" />
            </div>
          ) : (
            <iframe key={view.version} src={view.url} title="App preview" className="absolute inset-0 h-full w-full bg-white" />
          )
        ) : view?.devCommand ? (
          <div className="max-w-sm p-4 text-center text-[14px] text-ink-2">
            <p className="text-ink">This app runs with its own dev server.</p>
            <code className="mt-2 block rounded bg-[#0b0b0b] px-2 py-1.5 font-mono text-[13px] text-ink">{view.devCommand}</code>
            <div className="mt-3 flex justify-center gap-2">
              <button type="button" onClick={() => copy(`cd '${view.path}' && ${view.devCommand}`, "Dev command copied.")} className="rounded border border-line-strong px-2.5 py-1 text-ink hover:bg-[#1f1f1f]">
                Copy command
              </button>
              <button type="button" onClick={onTerminal} className="rounded border border-line-strong px-2.5 py-1 text-ink hover:bg-[#1f1f1f]">
                Open Terminal
              </button>
            </div>
          </div>
        ) : (
          <p className="p-4 text-center text-[14px] text-ink-3">{loading ? "Looking for an app to preview…" : view?.error ?? "Nothing to preview yet. A page appears here once the agent writes one."}</p>
        )}
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active} onClick={onClick} className={cx("grid size-7 place-items-center rounded hover:bg-[#1f1f1f] hover:text-ink", active ? "bg-[#1f1f1f] text-ink" : "text-ink-3")}>
      {children}
    </button>
  );
}

/** Downscales an image to at most 1800 px on its longest side and re-encodes it as WebP. */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL("image/webp", 0.9);
}

type Picked = { agentName: string; model: string | null; why: string; by: "ollama" | "rules" };

function AskAgents({ projectId, onStarted, target }: { projectId: string | null; onStarted: (id: string, pick: Picked) => void; target: () => DOMRect | null }) {
  const dialog = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [flying, setFlying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) area.current?.focus();
  }, [open]);

  const add = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    try {
      const out = await Promise.all(imgs.map(shrink));
      setImages((cur) => [...cur, ...out].slice(0, 6));
    } catch {
      setErr("That image couldn't be read. Try a PNG or JPEG.");
    }
  };

  const submit = async () => {
    if (!projectId) return setErr("Pick a project in the menu first.");
    if (!text.trim()) return setErr("Say what you want the agents to add.");
    setBusy(true);
    setErr(null);
    // The request folds into a paper plane right away and circles while the local model picks an agent.
    const from = dialog.current?.getBoundingClientRect();
    const flight = from ? startPaper(from, text) : null;
    setFlying(true);
    try {
      const r = await api<{ session: Session; pick: Picked }>("/api/advanced/ask", { body: { projectId, request: text, images } });
      onStarted(r.session.id, r.pick);
      setText("");
      setImages([]);
      setOpen(false);
      setFlying(false);
      // Let the pane switch to the new session first, then fly to it.
      requestAnimationFrame(() => void flight?.land(target(), r.pick.agentName));
    } catch (e) {
      flight?.abort();
      setFlying(false);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Ask the agents to add something (Cmd+K)"
        className="btn-step m-2 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-white px-4 text-[15px] font-semibold text-black hover:bg-[#e8e8e8]"
      >
        <MessageSquarePlus size={18} aria-hidden /> Ask the agents
      </button>
      {open && (
        <div className={cx("fixed inset-0 z-[60] grid place-items-center p-4 transition-opacity duration-200", flying && "pointer-events-none opacity-0")}>
          <button type="button" aria-label="Close" className="absolute inset-0 bg-[rgb(0_0_0/0.6)]" onClick={() => setOpen(false)} />
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-label="Ask the agents"
            className="relative flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-line-strong bg-[#0b0b0b] p-6"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void add(Array.from(e.dataTransfer.files));
            }}
          >
            <h2 className="text-[24px] font-semibold text-ink">What do you want the agents to add?</h2>
            <textarea
              ref={area}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.some((f) => f.type.startsWith("image/"))) {
                  e.preventDefault();
                  void add(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
              }}
              rows={6}
              placeholder="A dark mode toggle in the header, like this screenshot. Paste or drop images here."
              className="min-h-40 w-full resize-y rounded-lg border border-line bg-canvas p-4 text-[17px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
            />
            {images.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {images.map((src, i) => (
                  <li key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Attached image ${i + 1}`} className="h-20 w-28 rounded-md border border-line object-cover" />
                    <button type="button" aria-label={`Remove image ${i + 1}`} onClick={() => setImages(images.filter((_, j) => j !== i))} className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-white text-black">
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {err && <p className="text-[15px] text-bad">{err}</p>}
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden onChange={(e) => void add(Array.from(e.target.files ?? []))} />
              <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-11 items-center gap-2 rounded-lg border border-line-strong px-4 text-[15px] text-ink hover:bg-[#1f1f1f]">
                <ImagePlus size={16} aria-hidden /> Add images
              </button>
              <button type="button" disabled={busy} onClick={() => void submit()} className="ml-auto inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 text-[15px] font-semibold text-black hover:bg-[#e8e8e8] disabled:opacity-60">
                <Send size={15} aria-hidden /> {busy ? "Picking an agent…" : "Send to the agents"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function AdvancedView() {
  const { agents, project } = useWorkspace();
  const [picked, setPicked] = useState<string | null>(null);
  const { data, error } = useApi<{ sessions: AdvSession[] }>("/api/advanced", { interval: 4000 });
  const sessions = useMemo(() => data?.sessions ?? [], [data]);
  const logs = useLogs(data?.sessions);
  const [count, setCount] = useState<(typeof LAYOUTS)[number]>(2);
  const [panes, setPanes] = useState<(string | null)[]>([null, null, null, null]);
  const [focus, setFocus] = useState(0);
  const [seen, setSeen] = useState<Record<string, string> | null>(null);
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<"terminals" | "map">("terminals");
  const [notesOpen, setNotesOpen] = useState(false);
  const limitsApi = useApi<{ limits: Limit[] }>("/api/limits", { interval: 60_000 });
  const limits = useMemo(() => limitsApi.data?.limits ?? [], [limitsApi.data]);
  const warnings = limits.filter((l) => l.level !== "ok");
  const filled = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCount(store.get(LAYOUT_KEY, 2));
    setSeen(store.get<Record<string, string> | null>(SEEN_KEY, null));
  }, []);

  // First load: fill the panes with what is running, then the most recent sessions.
  useEffect(() => {
    if (filled.current || !sessions.length) return;
    filled.current = true;
    const order = [...sessions.filter((s) => LIVE.includes(s.status)), ...sessions.filter((s) => !LIVE.includes(s.status))];
    setPanes([0, 1, 2, 3].map((i) => order[i]?.id ?? null));
  }, [sessions]);

  const shown = useMemo(() => new Set(panes.slice(0, count).filter(Boolean) as string[]), [panes, count]);

  // Anything on screen counts as seen. On the first visit, everything that already ended counts as seen.
  useEffect(() => {
    if (!sessions.length) return;
    const first = !seen || !Object.keys(seen).length;
    let changed = false;
    const next = { ...seen };
    for (const s of sessions) {
      if ((first || shown.has(s.id)) && s.endedAt && next[s.id] !== s.endedAt) {
        next[s.id] = s.endedAt;
        changed = true;
      }
    }
    if (changed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeen(next);
      store.set(SEEN_KEY, next);
    }
  }, [sessions, shown, seen]);

  const needsYou = (s: Session) => !shown.has(s.id) && !!seen && !!s.endedAt && seen[s.id] !== s.endedAt && (s.status === "failed" || s.status === "completed");
  const unread = sessions.filter(needsYou).length;
  useEffect(() => {
    document.title = unread ? `(${unread}) Advanced · Nexus` : "Advanced · Nexus";
  }, [unread]);

  const visible = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return sessions.filter((s) => {
      const hay = `${s.title} ${s.agentId} ${s.status} ${s.worktreeBranch ?? ""} ${s.cwd}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [sessions, filter]);

  const put = useCallback(
    (id: string) => {
      setPanes((p) => {
        const n = [...p];
        const at = n.indexOf(id);
        if (at >= 0 && at < count) {
          setFocus(at);
          return n;
        }
        n[focus] = id;
        return n;
      });
    },
    [focus, count],
  );

  const setLayout = (c: (typeof LAYOUTS)[number]) => {
    setCount(c);
    store.set(LAYOUT_KEY, c);
    if (focus >= c) setFocus(0);
  };

  // Keyboard: Ctrl or Cmd + 1-9 opens that tab in the focused pane; Ctrl/Cmd + ] and [ move focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const d = Number(e.key);
      if (d >= 1 && d <= 9 && visible[d - 1]) {
        e.preventDefault();
        put(visible[d - 1].id);
      } else if (e.key === "]" || e.key === "[") {
        e.preventDefault();
        setFocus((f) => (f + (e.key === "]" ? 1 : count - 1)) % count);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, put, count]);

  const agentName = useCallback((id: string) => agents.find((a) => a.id === id)?.displayName ?? id, [agents]);
  const focusAt = useCallback((i: number) => setFocus(i), []);
  const closeAt = useCallback((i: number) => setPanes((p) => p.map((x, j) => (j === i ? null : x))), []);
  const openAt = useCallback((i: number, nid: string) => {
    setPanes((p) => p.map((x, j) => (j === i ? nid : x)));
    setFocus(i);
  }, []);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const running = sessions.filter((s) => s.status === "running" || s.status === "starting").length;

  return (
    <div className="force-dark -mx-3 -mt-5 -mb-24 flex h-[calc(100dvh-52px)] min-h-[520px] bg-canvas text-ink sm:-mx-4 lg:-mx-6">
      <aside aria-label="Sessions" className="flex w-72 shrink-0 flex-col border-r border-line">
        <div className="p-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter sessions"
            aria-label="Filter sessions"
            className="h-10 w-full rounded-md border border-line bg-[#0b0b0b] px-3 text-[14px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
          />
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {visible.map((s, i) => {
            const on = shown.has(s.id);
            const ring = needsYou(s);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => put(s.id)}
                  aria-current={on ? "true" : undefined}
                  className={cx("relative mb-1 block w-full rounded-md border px-3 py-2 text-left", on ? "border-[#4c8dff] bg-[#0f1a2e]" : ring ? (s.status === "failed" ? "border-bad" : "border-[#9ec9f7]") : "border-transparent hover:bg-[#141414]")}
                >
                  <span className="flex items-center gap-2">
                    <span className={cx("size-2 shrink-0 rounded-full", dotClass(s), ring && "ring-2 ring-current ring-offset-2 ring-offset-canvas")} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{s.title}</span>
                    {i < 9 && <kbd className="shrink-0 font-mono text-[12px] text-ink-3">⌘{i + 1}</kbd>}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[12.5px] text-ink-3">
                    {agentName(s.agentId)} {s.status} <Elapsed s={s} />
                  </span>
                  <span className="block truncate font-mono text-[12.5px] text-ink-3">{s.worktreeBranch ?? s.cwd.split("/").pop()}</span>
                  {ring && <span className="sr-only">Needs you: {s.status}</span>}
                </button>
              </li>
            );
          })}
          {!visible.length && <li className="px-2 py-6 text-[14px] text-ink-3">{error ?? (sessions.length ? "No session matches." : "No sessions yet. Start one from the Playground.")}</li>}
        </ul>
        <AskAgents
          projectId={project?.id ?? null}
          target={() => document.querySelector<HTMLElement>("[data-pane-focused]")?.getBoundingClientRect() ?? null}
          onStarted={(id, p) => {
            put(id);
            setPicked(`${p.by === "ollama" ? "Ollama picked" : "Picked"} ${p.agentName}${p.model ? ` (${p.model})` : ""}: ${p.why}`);
          }}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="shrink-0 whitespace-nowrap font-mono text-[14px] text-ink-2">
            <span className={cx("mr-2 inline-block size-2 rounded-full", running ? "bg-ok live-dot" : "bg-ink-3")} aria-hidden />
            {running} running{unread ? `, ${unread} need you` : ""}
            {!logs.liveOk && <span className="ml-2 text-warn">live stream reconnecting</span>}
          </span>
          {warnings.length > 0 && !picked && (
            <span className="min-w-0 flex-1 truncate font-mono text-[14px] text-warn" title={warnings.map((w) => w.text).join(" ")}>
              {warnings.map((w) => w.text).join(" ")}
            </span>
          )}
          {picked && (
            <span className="min-w-0 flex-1 truncate text-[14px] text-ink" title={picked}>
              {picked}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1" role="group" aria-label="Panes">
            <button type="button" onClick={() => setNotesOpen(true)} title="Rules and decisions every new step in this project gets" className="mr-1 inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-[14px] text-ink-3 hover:text-ink">
              <NotebookPen size={15} aria-hidden /> Notes
            </button>
            <button type="button" onClick={() => setMode(mode === "map" ? "terminals" : "map")} aria-pressed={mode === "map"} className={cx("mr-1 inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-[14px]", mode === "map" ? "bg-[#1f1f1f] text-ink" : "text-ink-3 hover:text-ink")}>
              <MapIcon size={15} aria-hidden /> Map
            </button>
            {LAYOUTS.map((c) => (
              <button key={c} type="button" onClick={() => setLayout(c)} aria-pressed={count === c} aria-label={`${c} pane${c > 1 ? "s" : ""}`} title={`${c} pane${c > 1 ? "s" : ""}`} className={cx("grid size-8 place-items-center rounded", count === c ? "bg-[#1f1f1f] text-ink" : "text-ink-3 hover:text-ink")}>
                {c === 1 ? <Square size={15} /> : c === 2 ? <Columns2 size={15} /> : <Grid2x2 size={15} />}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={logs.notify}
              title="Desktop notification when a session finishes or fails"
              onClick={async () => {
                if (typeof Notification === "undefined") return;
                if (!logs.notify && Notification.permission !== "granted") await Notification.requestPermission();
                logs.setNotify(!logs.notify && Notification.permission === "granted");
              }}
              className={cx("ml-1 inline-flex h-8 items-center gap-1.5 rounded px-2 text-[14px]", logs.notify ? "bg-[#1f1f1f] text-ink" : "text-ink-3 hover:text-ink")}
            >
              <Bell size={15} aria-hidden /> {logs.notify ? "Notifying" : "Notify me"}
            </button>
            <Link href="/runs" className="ml-1 inline-flex h-8 items-center rounded px-2 text-[14px] text-ink-3 hover:text-ink">
              Simple view
            </Link>
          </div>
        </div>
        {mode === "map" && (
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <ConceptMap projectId={project?.id ?? null} agentName={agentName} />
          </div>
        )}
        <div className={cx("grid min-h-0 flex-1 gap-2 p-2", mode === "map" && "hidden", count === 1 ? "grid-cols-1" : count === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-2 md:grid-rows-2")}>
          {panes.slice(0, count).map((id, i) => {
            const s = id ? byId.get(id) ?? null : null;
            return (
              <Pane
                key={i}
                index={i}
                s={s}
                log={s ? logs.get(s.id) : undefined}
                load={logs.load}
                focused={focus === i}
                onFocus={focusAt}
                onClose={closeAt}
                agentName={agentName}
                roomy={count <= 2}
                onOpen={openAt}
                version={s ? logs.version(s.id) : 0}
                limit={s ? (limits.find((l) => l.agentId === s.agentId) ?? null) : null}
              />
            );
          })}
        </div>
      </div>
      <ProjectNotes projectId={project?.id ?? null} projectName={project?.name ?? "this project"} open={notesOpen} onClose={() => setNotesOpen(false)} dark />
    </div>
  );
}
