"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Pencil, Square, Undo2 } from "lucide-react";
import { Button, Dialog, cx } from "./ui";

type Pt = { x: number; y: number };
type Mark = { tool: Tool; pts: Pt[] };
type Tool = "box" | "arrow" | "pen";
const TOOLS: { id: Tool; label: string; icon: typeof Square }[] = [
  { id: "box", label: "Box", icon: Square },
  { id: "arrow", label: "Arrow", icon: ArrowUpRight },
  { id: "pen", label: "Pen", icon: Pencil },
];

function paint(c: CanvasRenderingContext2D, m: Mark, w: number) {
  const [a, b] = [m.pts[0], m.pts.at(-1)!];
  c.strokeStyle = "#ff3b30";
  c.lineWidth = w;
  c.lineJoin = c.lineCap = "round";
  c.beginPath();
  if (m.tool === "box") c.rect(a.x, a.y, b.x - a.x, b.y - a.y);
  else if (m.tool === "pen") m.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  else {
    const t = Math.atan2(b.y - a.y, b.x - a.x);
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    for (const d of [2.6, -2.6]) {
      c.moveTo(b.x, b.y);
      c.lineTo(b.x + Math.cos(t + d) * w * 5, b.y + Math.sin(t + d) * w * 5);
    }
  }
  c.stroke();
}

/** Draw on a picture before sending it: boxes, arrows or a pen. */
export function Annotate({ src, onDone, onClose }: { src: string | null; onDone: (image: string) => void; onClose: () => void }) {
  return (
    <Dialog open={!!src} onClose={onClose} wide title="Mark what to change">
      {src && <Inner key={src.slice(-60)} src={src} onDone={onDone} onClose={onClose} />}
    </Dialog>
  );
}

function Inner({ src, onDone, onClose }: { src: string; onDone: (image: string) => void; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>("box");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const draft = useRef<Mark | null>(null);

  const draw = () => {
    const el = canvas.current;
    const c = el?.getContext("2d");
    if (!el || !c || !img.current) return;
    c.drawImage(img.current, 0, 0, el.width, el.height);
    const w = Math.max(3, el.width / 260);
    for (const m of draft.current ? [...marks, draft.current] : marks) paint(c, m, w);
  };
  useEffect(() => {
    const i = new Image();
    i.onload = () => {
      const k = Math.min(1, 1800 / Math.max(i.width, i.height));
      const el = canvas.current!;
      el.width = Math.round(i.width * k);
      el.height = Math.round(i.height * k);
      img.current = i;
      setReady(true);
    };
    i.onerror = () => setError(true);
    i.src = src;
  }, [src]);
  useEffect(draw);

  const at = (e: React.PointerEvent): Pt => {
    const el = canvas.current!;
    const r = el.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * el.width, y: ((e.clientY - r.top) / r.height) * el.height };
  };
  if (error) return <p className="text-bad">That image couldn&apos;t be read. Try a PNG or JPEG.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Drawing tools">
        {TOOLS.map((t) => (
          <Button key={t.id} size="sm" aria-pressed={tool === t.id} variant={tool === t.id ? "primary" : "secondary"} onClick={() => setTool(t.id)}>
            <t.icon size={14} aria-hidden /> {t.label}
          </Button>
        ))}
        <Button size="sm" variant="ghost" disabled={!marks.length} onClick={() => setMarks(marks.slice(0, -1))}>
          <Undo2 size={14} aria-hidden /> Undo
        </Button>
      </div>
      <canvas
        ref={canvas}
        aria-label="Picture. Drag to mark it."
        className={cx("max-h-[58vh] w-auto max-w-full cursor-crosshair touch-none self-center border border-line", !ready && "opacity-0")}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          draft.current = { tool, pts: [at(e)] };
        }}
        onPointerMove={(e) => {
          if (!draft.current) return;
          draft.current.pts.push(at(e));
          draw();
        }}
        onPointerUp={() => {
          const m = draft.current;
          draft.current = null;
          if (m && m.pts.length > 1) setMarks([...marks, m]);
        }}
      />
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!ready} onClick={() => onDone(canvas.current!.toDataURL("image/webp", 0.9))}>
          Attach
        </Button>
      </div>
    </div>
  );
}
