"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, Folder } from "lucide-react";
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

const tileWidth = (lines: number) => Math.round(Math.min(230, Math.max(78, 46 + Math.sqrt(lines) * 7)));

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={box} className="canvas-ground relative min-h-0 flex-1 overflow-auto rounded-md border border-line">
        <div className="relative flex flex-wrap content-start items-start gap-4 p-6">
          {districts.map(([dir, files]) => (
            <section key={dir || "root"} className="max-w-[560px] min-w-[200px] rounded-xl border border-line bg-[rgb(12_12_12/0.82)] p-3 backdrop-blur-sm" aria-label={`Folder ${dir || "project root"}`}>
              <h3 className="mb-2 flex items-center gap-1.5 font-mono text-[13px] text-ink-2">
                <Folder size={13} aria-hidden /> {dir || "project root"}
                <span className="text-ink-3">{files.length}</span>
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {files.map((f) => {
                  const t = touched.get(f.path);
                  const linked = hover && (hoverFile?.imports.includes(f.path) || byPath.get(f.path)?.imports.includes(hover));
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
                      title={[f.path, `${f.lines} lines`, f.purpose, f.symbols.length ? `defines ${f.symbols.join(", ")}` : null, t ? `${t.kind === "edit" ? "edited" : "read"} by ${t.who.join(", ")}` : null].filter(Boolean).join("\n")}
                      style={{ width: tileWidth(f.lines), ...(t ? { borderColor: t.color, boxShadow: t.kind === "edit" ? `0 0 0 1px ${t.color}, 0 0 22px -4px ${t.color}` : undefined } : {}) }}
                      className={cx(
                        "map-tile relative cursor-default rounded-lg border bg-[#141414] px-2 py-1.5 transition-[box-shadow,border-color,opacity] duration-500",
                        t ? "" : "border-line",
                        hover && hover !== f.path && !linked && "opacity-45",
                        linked && "border-[#4c8dff]",
                      )}
                    >
                      <span className="flex items-center gap-1 truncate font-mono text-[12.5px] text-ink">
                        {f.added && <FilePlus2 size={11} className="shrink-0 text-ok" aria-label="new file" />}
                        <span className="truncate">{f.path.split("/").pop()}</span>
                      </span>
                      <span className="block font-mono text-[11px] text-ink-3">
                        {f.added ? "new" : f.binary ? "file" : `${f.lines} lines`}
                        {t ? ` · ${t.kind === "edit" ? "edited" : "read"}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <svg className="pointer-events-none absolute top-0 left-0" width={area.w} height={area.h} aria-hidden>
          {/* Import links: faint everywhere, bright for the file under the pointer. */}
          {(data.files ?? []).flatMap((f) =>
            f.imports.map((to) => {
              const a = pos[f.path];
              const b = pos[to];
              if (!a || !b) return null;
              const on = hover === f.path || hover === to;
              return <path key={`${f.path}>${to}`} d={curve(a, b)} fill="none" stroke={on ? "#4c8dff" : "#ffffff"} strokeOpacity={on ? 0.9 : 0.07} strokeWidth={on ? 1.6 : 1} />;
            }),
          )}
          {/* Each agent's recent path through the files. */}
          {shownAgents.map((a) => {
            const pts = a.touches
              .slice(-7)
              .map((t) => pos[t.file])
              .filter((p, i, arr): p is Pt & { w: number; h: number } => !!p && (i === 0 || p !== arr[i - 1]));
            if (pts.length < 2) return null;
            const d = pts.slice(1).reduce((acc, p, i) => `${acc} ${curve(pts[i], p).replace(/^M[^Q]+/, "")}`, `M${pts[0].x},${pts[0].y}`);
            return <path key={a.sessionId} d={d} fill="none" stroke={a.color} strokeWidth={2} strokeOpacity={LIVE.includes(a.status) ? 0.85 : 0.35} className="map-trail" />;
          })}
        </svg>

        {/* Agent markers sit on the file they touched last and glide to the next one. */}
        {shownAgents.map((a, i) => {
          const last = a.touches[a.touches.length - 1];
          const p = last ? pos[last.file] : null;
          if (!p) return null;
          const running = LIVE.includes(a.status);
          // Names stay on markers that are working now (or the one picked below), so finished ones don't crowd.
          const tag = running || focus === a.sessionId;
          return (
            <div
              key={a.sessionId}
              className="map-agent pointer-events-none absolute z-10"
              style={{ left: p.x - p.w / 2 + 6 + i * 16, top: p.y - p.h / 2 - 14 }}
              title={`${agentName(a.agentId)}: ${a.title}`}
            >
              <span className={cx("relative grid size-7 place-items-center rounded-full text-[12px] font-bold text-black", running && "map-agent-live")} style={{ background: a.color, ["--c" as string]: a.color }}>
                {agentName(a.agentId)[0]}
              </span>
              {tag && <span className="absolute top-0.5 left-8 rounded-full px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap text-black" style={{ background: a.color }}>
                {agentName(a.agentId)}
                {running ? ` ${last.kind === "edit" ? "editing" : "reading"} ${last.file.split("/").pop()}` : ""}
              </span>}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2" role="group" aria-label="Agents on the map">
        {agents.map((a) => (
          <button
            key={a.sessionId}
            type="button"
            aria-pressed={focus === a.sessionId}
            onClick={() => setFocus(focus === a.sessionId ? null : a.sessionId)}
            className={cx("inline-flex h-9 max-w-72 items-center gap-2 rounded-full border px-3 text-[14px]", focus === a.sessionId ? "border-ink text-ink" : "border-line text-ink-2 hover:text-ink")}
          >
            <span className={cx("size-2.5 shrink-0 rounded-full", LIVE.includes(a.status) && "live-dot")} style={{ background: a.color }} aria-hidden />
            <span className="truncate">
              {agentName(a.agentId)}: {a.title}
            </span>
          </button>
        ))}
        {!agents.length && <span className="text-[14px] text-ink-3">No agent has read or edited a file in this project yet.</span>}
        {data.truncated && <span className="text-[14px] text-ink-3">Showing the first 300 files.</span>}
      </div>
    </div>
  );
}
