import type { CSSProperties, ReactNode } from "react";
import { cx } from "./ui";

/** Waiting, drawn as what is being waited for. Each place has its own small scene. */
export type WaitKind = "send" | "ideas" | "page" | "write" | "judge" | "queue" | "open" | "scan" | "agents" | "list" | "think";

const d = (s: number) => ({ animationDelay: `${s}s` }) as CSSProperties;
const INK = "var(--ink)";
const DIM = "var(--line-strong)";
const PATH = "M 14 92 C 70 92 92 20 150 20 C 200 20 206 78 164 78 C 122 78 128 20 178 20 C 236 20 252 92 306 82";
const STARS: [number, number][] = [[70, 70], [110, 30], [155, 62], [200, 24], [248, 66]];

const SCENES: Record<WaitKind, ReactNode> = {
  // A paper plane carries the request to the agents.
  send: (
    <>
      <path d={PATH} fill="none" stroke={DIM} strokeWidth="1.5" strokeDasharray="2 7" strokeLinecap="round" />
      <g className="w-moving">
        <animateMotion dur="3.2s" repeatCount="indefinite" rotate="auto" path={PATH} />
        <path d="M 22 0 L -16 -15 L -8 0 L -16 15 Z" fill={INK} />
        <path d="M 22 0 L -8 0 L -11 9 Z" fill="var(--ink-3)" />
      </g>
    </>
  ),
  // Loose points join into a constellation.
  ideas: (
    <>
      <polyline className="w-join" pathLength="100" points={STARS.map((p) => p.join(",")).join(" ")} fill="none" stroke={INK} strokeWidth="1.5" />
      {STARS.map(([x, y], i) => (
        <path key={i} className="w-twinkle" style={d(i * 0.28)} d={`M ${x} ${y - 10} L ${x + 2.5} ${y - 2.5} L ${x + 10} ${y} L ${x + 2.5} ${y + 2.5} L ${x} ${y + 10} L ${x - 2.5} ${y + 2.5} L ${x - 10} ${y} L ${x - 2.5} ${y - 2.5} Z`} fill={INK} />
      ))}
    </>
  ),
  // A page puts itself together, block by block.
  page: (
    <>
      <rect x="95" y="6" width="130" height="96" rx="5" fill="none" stroke={DIM} strokeWidth="1.5" />
      {[[103, 15, 114, 9, 0], [103, 31, 66, 30, 0.25], [176, 31, 41, 30, 0.5], [103, 68, 33, 26, 0.75], [143, 68, 34, 26, 0.95], [184, 68, 33, 26, 1.15]].map(([x, y, w, h, t]) => (
        <rect key={`${x}${y}`} className="w-drop" style={d(t)} x={x} y={y} width={w} height={h} rx="2" fill={INK} />
      ))}
    </>
  ),
  // Lines of a document get written.
  write: (
    <>
      <rect x="110" y="4" width="100" height="100" rx="4" fill="none" stroke={DIM} strokeWidth="1.5" />
      {[[60, 24], [76, 42], [70, 60], [44, 78]].map(([w, y], i) => (
        <line key={y} className="w-line" pathLength="100" style={d(i * 0.55)} x1="122" x2={122 + w} y1={y} y2={y} stroke={INK} strokeWidth="4" strokeLinecap="round" />
      ))}
      <g className="w-pen">
        <path d="M 0 0 L 5 -12 L 30 -37 L 37 -30 L 12 -5 Z" fill={INK} stroke="var(--canvas)" strokeWidth="2" />
      </g>
    </>
  ),
  // Scales tip one way, then the other.
  judge: (
    <>
      <path d="M 160 18 V 96 M 136 98 H 184" stroke={DIM} strokeWidth="3" strokeLinecap="round" />
      <g className="w-tip" style={{ transformOrigin: "160px 22px" }}>
        <path d="M 102 22 H 218" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        {[102, 218].map((x) => (
          <path key={x} d={`M ${x} 22 L ${x - 22} 60 H ${x + 22} Z M ${x - 22} 60 Q ${x} 80 ${x + 22} 60`} fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        ))}
      </g>
    </>
  ),
  // Cards move up in line.
  queue: (
    <>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} className="w-line-up" style={d(-i * 0.9)} x="28" y="30" width="46" height="46" rx="6" fill={INK} />
      ))}
      <path d="M 40 92 H 280" stroke={DIM} strokeWidth="2" strokeDasharray="2 7" strokeLinecap="round" />
    </>
  ),
  // A folder opens and its pages rise.
  open: (
    <>
      <path d="M 108 38 h 34 l 10 10 h 60 v 52 h -104 Z" fill="none" stroke={DIM} strokeWidth="2" strokeLinejoin="round" />
      {[122, 148, 174].map((x, i) => (
        <rect key={x} className="w-rise" style={d(i * 0.22)} x={x} y="38" width="24" height="36" rx="2" fill={INK} />
      ))}
      <path d="M 100 60 h 120 l -10 42 h -100 Z" fill="var(--surface-2)" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
    </>
  ),
  // A lens passes over lines of code.
  scan: (
    <>
      {[20, 38, 56, 74, 92].map((y, i) => (
        <line key={y} x1={96 + (i % 3) * 12} x2={188 + ((i * 29) % 44)} y1={y} y2={y} stroke={DIM} strokeWidth="4" strokeLinecap="round" />
      ))}
      <g className="w-lens">
        <circle cx="124" cy="36" r="21" fill="color-mix(in oklab, var(--ink) 12%, transparent)" stroke={INK} strokeWidth="3" />
        <path d="M 140 52 L 156 68" stroke={INK} strokeWidth="5" strokeLinecap="round" />
      </g>
    </>
  ),
  // The Nexus mark: a signal goes out to each agent.
  agents: (
    <>
      {[18, 54, 90].map((y, i) => (
        <g key={y}>
          <path d={`M 90 54 C 150 54 150 ${y} 222 ${y}`} fill="none" stroke={DIM} strokeWidth="2" />
          <path className="w-signal" pathLength="100" style={d(i * 0.35)} d={`M 90 54 C 150 54 150 ${y} 222 ${y}`} fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
          <circle className="w-ping" style={d(i * 0.35)} cx="232" cy={y} r="9" fill={INK} />
        </g>
      ))}
      <circle cx="82" cy="54" r="13" fill={INK} />
    </>
  ),
  // Rows slide in.
  list: (
    <>
      {[14, 42, 70].map((y, i) => (
        <g key={y} className="w-row" style={d(i * 0.18)}>
          <rect x="84" y={y} width="20" height="20" rx="4" fill={INK} />
          <rect x="116" y={y + 2} width={120 - i * 20} height="6" rx="3" fill={INK} />
          <rect x="116" y={y + 13} width={74 - i * 8} height="5" rx="2.5" fill={DIM} />
        </g>
      ))}
    </>
  ),
  // Someone thinking before they speak.
  think: (
    <>
      <path d="M 112 14 h 96 q 12 0 12 12 v 40 q 0 12 -12 12 h -58 l -18 18 v -18 h -20 q -12 0 -12 -12 v -40 q 0 -12 12 -12 Z" fill="none" stroke={DIM} strokeWidth="2" />
      {[136, 160, 184].map((x, i) => (
        <circle key={x} className="w-dot" style={d(i * 0.16)} cx={x} cy="46" r="6" fill={INK} />
      ))}
    </>
  ),
};

export function Wait({ kind, label, className, small }: { kind: WaitKind; label: string; className?: string; small?: boolean }) {
  return (
    <div role="status" data-wait={kind} className={cx("flex w-full flex-col items-center gap-3 text-center", className)}>
      <svg viewBox="0 0 320 108" aria-hidden className={cx("w-full overflow-visible", small ? "max-w-[180px]" : "max-w-[300px]")}>
        {SCENES[kind]}
      </svg>
      <p className={cx("text-ink-2", small ? "text-[13px]" : "text-[15px]")}>{label}</p>
    </div>
  );
}
