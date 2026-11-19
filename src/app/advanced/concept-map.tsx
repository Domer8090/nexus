"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Folder } from "lucide-react";
import { useApi } from "@/lib/client";
import { subscribeLive } from "@/lib/live";
import { touchOf, type Touch } from "@/lib/touch";
import { cx } from "@/components/ui";

/**
 * The project as a map. Folders are districts, files are tiles sized by their line count, and
 * import links run between them. Each agent is a marker that moves to the file it is reading or
 * editing right now, trailing the path it took; files it edited glow in its colour. Live from the
 * same stream as the terminals.
 */

type MapFile = { path: string; dir: string; lines: number; purpose: string | null; symbols: string[]; imports: string[]; added?: boolean; binary?: boolean };
type MapAgent = { sessionId: string; agentId: string; title: string; status: string; cwd: string; touches: Touch[] };
type MapResp = { files: MapFile[]; agents: MapAgent[]; truncated: boolean };
type Pt = { x: number; y: number };

const COLORS = ["#f5a08b", "#9ec9f7", "#a9e0b5", "#caa8f7", "#f4d68a", "#f7a8cf", "#8be0e0", "#f0b27a"];
const LIVE = ["running", "starting"];

/** Two letters per agent, so Claude Code and Codex are told apart at a glance. */
const code = (agentId: string) => ({ "claude-code": "CC", codex: "CX", ollama: "OL", gemini: "GE", opencode: "OC", aider: "AI" })[agentId] ?? agentId.slice(0, 2).toUpperCase();

const EXT_COLOR: Record<string, string> = { html: "#f0a35e", css: "#6aa8ff", scss: "#d77fb0", js: "#f2d15c", mjs: "#f2d15c", jsx: "#f2d15c", ts: "#5aa2ff", tsx: "#5aa2ff", json: "#9bd27c", md: "#a8a8a8", py: "#7ab6e8", png: "#c49bf2", jpg: "#c49bf2", jpeg: "#c49bf2", webp: "#c49bf2", svg: "#f59fbf", gif: "#c49bf2" };
const extColor = (name: string) => EXT_COLOR[name.split(".").pop()?.toLowerCase() ?? ""] ?? "#6e6e6e";

export function ConceptMap({ projectId, agentName }: { projectId: string | null; agentName: (id: string) => string }) {
  const { data, error, reload } = useApi<MapResp>(projectId ? `/api/advanced/map?projectId=${projectId}` : null, { interval: 30_000 });
  const [live, setLive] = useState<Record<string, Touch[]>>({});
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [pos, setPos] = useState<Record<string, Pt & { w: number; h: number }>>({});
  const [area, setArea] = useState({ w: 0, h: 0 });
  const box = useRef<HTMLDivElement>(null);
  const tiles = useRef(new Map<string, HTMLElement>());

  const agents = useMemo(() => {
    const list = data?.agents ?? [];
    return list.map((a, i) => {
      const extra = (live[a.sessionId] ?? []).filter((t) => !a.touches.some((x) => x.id === t.id));
      return { ...a, color: COLORS[i % COLORS.length], touches: [...a.touches, ...extra].slice(-40) };
    });
  }, [data, live]);

  // New reads and edits arrive on the shared live stream; an unknown session means a new run, so reload.
  const cwdOf = useRef(new Map<string, string>());
  useEffect(() => {
    cwdOf.current = new Map((data?.agents ?? []).map((a) => [a.sessionId, a.cwd]));
  }, [data]);
  useEffect(() => {
    let pending: number | null = null;
    return subscribeLive({
      onEvent: (e) => {
        const cwd = cwdOf.current.get(e.sessionId);
        if (!cwd) {
          if (e.kind === "tool" || e.kind === "file") {
            if (pending) window.clearTimeout(pending);
            pending = window.setTimeout(reload, 800);
          }
          return;
        }
        const t = touchOf(e, cwd);
        if (t) setLive((cur) => ({ ...cur, [e.sessionId]: [...(cur[e.sessionId] ?? []), t].slice(-40) }));
      },
    });
  }, [reload]);

  const districts = useMemo(() => {
    const by = new Map<string, MapFile[]>();
    for (const f of data?.files ?? []) {
      const top = f.dir.split("/").slice(0, 2).join("/");
      by.set(top, [...(by.get(top) ?? []), f]);
    }
    return [...by.entries()].sort((a, b) => (a[0] === "" ? -1 : b[0] === "" ? 1 : b[1].length - a[1].length));
  }, [data]);

  // Measure every tile so markers, trails and links can be drawn over the layout.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const next: Record<string, Pt & { w: number; h: number }> = {};
      for (const [p, t] of tiles.current) {
        const r = t.getBoundingClientRect();
        next[p] = { x: r.left - base.left + el.scrollLeft + r.width / 2, y: r.top - base.top + el.scrollTop + r.height / 2, w: r.width, h: r.height };
      }
      setPos(next);
      setArea({ w: el.scrollWidth, h: el.scrollHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [districts]);

  const touched = useMemo(() => {
    const m = new Map<string, { color: string; kind: "read" | "edit"; who: string[] }>();
    for (const a of agents) {
      if (focus && a.sessionId !== focus) continue;
      for (const t of a.touches) {
        const cur = m.get(t.file);
        const kind = cur?.kind === "edit" || t.kind === "edit" ? "edit" : "read";
        const who = Array.from(new Set([...(cur?.who ?? []), agentName(a.agentId)]));
        m.set(t.file, { color: cur?.kind === "edit" && t.kind !== "edit" ? cur.color : a.color, kind, who });
      }
    }
    return m;
  }, [agents, focus, agentName]);

  const byPath = useMemo(() => new Map((data?.files ?? []).map((f) => [f.path, f])), [data]);
  const curve = (a: Pt, b: Pt) => {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2 - Math.min(80, Math.abs(a.x - b.x) * 0.25 + 20);
    return `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
  };

  if (!projectId) return <p className="p-8 text-[16px] text-ink-3">Pick a project in the menu to see its map.</p>;
  if (error && !data) return <p className="p-8 text-[16px] text-bad">{error}</p>;
  if (!data) return <p className="p-8 text-[16px] text-ink-3">Mapping the project…</p>;

  const hoverFile = hover ? byPath.get(hover) : null;
  const shownAgents = agents.filter((a) => !focus || a.sessionId === focus);
  const maxLines = Math.max(1, ...(data.files ?? []).filter((f) => !f.binary && !f.added).map((f) => f.lines));
  // Agents standing on the same file line up along its top edge instead of piling up.
  const slot = new Map<string, number>();
  const placeOf = (file: string) => {
    const n = slot.get(file) ?? 0;
    slot.set(file, n + 1);
    return n;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={box} className="canvas-ground relative min-h-0 flex-1 overflow-auto rounded-md border border-line">
        <svg className="pointer-events-none absolute top-0 left-0 z-0" width={area.w} height={area.h} aria-hidden>
          {/* Import links: faint everywhere, bright for the file under the pointer. They run under the tiles. */}
          {(data.files ?? []).flatMap((f) =>
            f.imports.map((to) => {
              const a = pos[f.path];
              const b = pos[to];
              if (!a || !b) return null;
              const on = hover === f.path || hover === to;
              return <path key={`${f.path}>${to}`} d={curve(a, b)} fill="none" stroke={on ? "#4c8dff" : "#ffffff"} strokeOpacity={on ? 0.95 : 0.1} strokeWidth={on ? 2 : 1} />;
            }),
          )}
          {/* The recent path of agents that are working now, or the one picked below. */}
          {shownAgents
            .filter((a) => LIVE.includes(a.status) || focus === a.sessionId)
            .map((a) => {
              const pts = a.touches
                .slice(-8)
                .map((t) => pos[t.file])
                .filter((p, i, arr): p is Pt & { w: number; h: number } => !!p && (i === 0 || p !== arr[i - 1]));
              if (pts.length < 2) return null;
              const d = pts.slice(1).reduce((acc, p, i) => `${acc} ${curve(pts[i], p).replace(/^M[^Q]+/, "")}`, `M${pts[0].x},${pts[0].y}`);
              return <path key={a.sessionId} d={d} fill="none" stroke={a.color} strokeWidth={2.5} strokeOpacity={0.9} className="map-trail" />;
            })}
        </svg>

        <div className="relative z-[1] grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] content-start gap-5 p-6">
          {districts.map(([dir, files]) => (
            <section key={dir || "root"} className="rounded-2xl border border-line bg-[rgb(14_14_14/0.72)] p-4" aria-label={`Folder ${dir || "project root"}`}>
              <h3 className="mb-3 flex items-center gap-2 text-[15px] font-medium text-ink">
                <Folder size={15} className="text-ink-3" aria-hidden /> {dir || "Project root"}
                <span className="ml-auto font-mono text-[12px] text-ink-3">{files.length} {files.length === 1 ? "file" : "files"}</span>
              </h3>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
                {files.map((f) => {
                  const t = touched.get(f.path);
                  const linked = hover && (hoverFile?.imports.includes(f.path) || byPath.get(f.path)?.imports.includes(hover));
                  const name = f.path.split("/").pop() ?? f.path;
                  return (
                    <li
                      key={f.path}
                      ref={(el) => {
                        if (el) tiles.current.set(f.path, el);
                        else tiles.current.delete(f.path);
                      }}
                      onMouseEnter={() => setHover(f.path)}
                      onMouseLeave={() => setHover((h) => (h === f.path ? null : h))}
                      tabIndex={0}
                      onFocus={() => setHover(f.path)}
                      onBlur={() => setHover(null)}
                      title={[f.path, f.binary ? "binary file" : `${f.lines} lines`, f.purpose, f.symbols.length ? `defines ${f.symbols.join(", ")}` : null, t ? `${t.kind === "edit" ? "edited" : "read"} by ${t.who.join(", ")}` : null].filter(Boolean).join("\n")}
                      style={t ? { borderColor: t.color, boxShadow: t.kind === "edit" ? `0 0 0 1px ${t.color}, 0 0 26px -6px ${t.color}` : undefined } : undefined}
                      className={cx(
                        "relative flex h-[76px] cursor-default flex-col justify-between rounded-xl border bg-[#151515] px-3 py-2.5 transition-[box-shadow,border-color,opacity] duration-500",
                        t ? "" : "border-[#262626]",
                        hover && hover !== f.path && !linked && "opacity-40",
                        linked && "!border-[#4c8dff]",
                      )}
                    >
                      <span className="flex min-w-0 items-start gap-2">
                        <span className="mt-[5px] size-2 shrink-0 rounded-full" style={{ background: extColor(name) }} aria-hidden />
                        <span className="line-clamp-2 min-w-0 font-mono text-[13px] leading-[1.3] break-all text-ink">{name}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        {f.added || f.binary ? (
                          <span className="font-mono text-[11.5px] text-ink-3">{f.added ? "new file" : "binary"}</span>
                        ) : (
                          <>
                            <span className="h-1 flex-1 overflow-hidden rounded-full bg-[#262626]">
                              <span className="block h-full rounded-full bg-[#5a5a5a]" style={{ width: `${Math.max(4, Math.round((Math.sqrt(f.lines) / Math.sqrt(maxLines)) * 100))}%` }} />
                            </span>
                            <span className="shrink-0 font-mono text-[11.5px] text-ink-3">{f.lines}</span>
                          </>
                        )}
                        {t && (
                          <span className="shrink-0 rounded-full px-1.5 py-px text-[11px] font-semibold" style={t.kind === "edit" ? { background: t.color, color: "#0b0b0b" } : { color: t.color, boxShadow: `inset 0 0 0 1px ${t.color}` }}>
                            {t.kind === "edit" ? "edited" : "read"}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        {/* Agent markers sit on the top edge of the file they touched last and glide to the next one. */}
        {shownAgents.map((a) => {
          const last = a.touches[a.touches.length - 1];
          const p = last ? pos[last.file] : null;
          if (!p) return null;
          const running = LIVE.includes(a.status);
          const n = placeOf(last.file);
          const tag = running || focus === a.sessionId;
          return (
            <div key={a.sessionId} className="map-agent pointer-events-none absolute z-10" style={{ left: p.x + p.w / 2 - 34 - n * 26, top: p.y - p.h / 2 - 15 }} title={`${agentName(a.agentId)}: ${a.title}`}>
              <span
                className={cx("relative grid size-[30px] place-items-center rounded-full border-2 border-[#0b0b0b] text-[11px] font-bold tracking-tight text-black", running && "map-agent-live")}
                style={{ background: a.color, ["--c" as string]: a.color }}
              >
                {code(a.agentId)}
              </span>
              {tag && (
                <span className="absolute top-1 right-9 rounded-full px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap text-black shadow-[0_6px_16px_rgb(0_0_0/0.45)]" style={{ background: a.color }}>
                  {agentName(a.agentId)}
                  {running ? ` ${last.kind === "edit" ? "editing" : "reading"} ${last.file.split("/").pop()}` : ""}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-3" role="group" aria-label="Agents on the map">
        {agents.map((a) => {
          const edits = new Set(a.touches.filter((t) => t.kind === "edit").map((t) => t.file)).size;
          const reads = new Set(a.touches.filter((t) => t.kind === "read").map((t) => t.file)).size;
          return (
            <button
              key={a.sessionId}
              type="button"
              aria-pressed={focus === a.sessionId}
              onClick={() => setFocus(focus === a.sessionId ? null : a.sessionId)}
              className={cx("inline-flex h-11 max-w-sm items-center gap-2.5 rounded-full border pr-4 pl-1.5 text-[14px]", focus === a.sessionId ? "border-ink bg-[#1a1a1a] text-ink" : "border-line text-ink-2 hover:text-ink")}
            >
              <span className={cx("grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-black", LIVE.includes(a.status) && "map-agent-live")} style={{ background: a.color, ["--c" as string]: a.color }} aria-hidden>
                {code(a.agentId)}
              </span>
              <span className="min-w-0 truncate">{a.title}</span>
              <span className="shrink-0 font-mono text-[12px] text-ink-3">
                {edits} edited, {reads} read
              </span>
            </button>
          );
        })}
        {!agents.length && <span className="text-[14px] text-ink-3">No agent has read or edited a file in this project yet.</span>}
        {data.truncated && <span className="text-[14px] text-ink-3">Showing the first 300 files.</span>}
      </div>
    </div>
  );
}
