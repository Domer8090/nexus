/**
 * Send animation for "Ask the agents", in two phases so it covers the time the local model takes
 * to pick an agent:
 *
 *   start(): the request folds from the dialog into a sheet, the sheet becomes a paper plane, and the
 *            plane circles in place with "Picking an agent…".
 *   land():  the plane takes the agent's name and flies a long arc to that agent's pane, drawing a
 *            dotted trail, and the pane pulses when it lands.
 *   abort(): the plane drops and fades (the request failed; the dialog comes back).
 *
 * Plain Web Animations on fixed elements. With reduced motion the plane only fades.
 */

const PLANE = `<svg width="76" height="76" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M22 2 11 13" stroke="#0b0b0b" stroke-width="1.1" stroke-linejoin="round"/><path d="M22 2 15 22l-4-9-9-4 20-7Z" fill="#ffffff" stroke="#0b0b0b" stroke-width="1.1" stroke-linejoin="round"/><path d="M11 13 15 22" stroke="#c9d3e6" stroke-width="1"/></svg>`;

function el(tag: string, style: Partial<CSSStyleDeclaration>, html = "") {
  const e = document.createElement(tag);
  Object.assign(e.style, { position: "fixed", pointerEvents: "none", ...style });
  e.innerHTML = html;
  document.body.append(e);
  return e;
}

export type PaperFlight = { land: (to: DOMRect | null, agent: string) => Promise<void>; abort: () => void };

export function startPaper(from: DOMRect, text: string): PaperFlight {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;

  // The request as a sheet of paper, folding small.
  const sheet = el("div", {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    zIndex: "95",
    background: "linear-gradient(180deg,#ffffff,#e9eef7)",
    color: "#111",
    borderRadius: "16px",
    padding: "32px",
    font: "600 20px/1.45 system-ui, sans-serif",
    overflow: "hidden",
    boxShadow: "0 40px 100px rgb(0 0 0 / .6)",
  });
  sheet.textContent = text.slice(0, 240);
  const fold = sheet.animate(
    reduce
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { transform: "none", borderRadius: "16px" },
          { transform: "perspective(1000px) rotateX(55deg) scale(.7)", offset: 0.4 },
          { transform: "perspective(1000px) rotateY(60deg) scale(.35, .3)", offset: 0.75 },
          { transform: "rotateZ(-20deg) scale(.08, .06)", borderRadius: "3px" },
        ],
    { duration: reduce ? 200 : 650, easing: "cubic-bezier(.6,.05,.3,1)", fill: "forwards" },
  );

  // The plane, circling while the agent is picked.
  const plane = el("div", { left: `${cx - 38}px`, top: `${cy - 38}px`, zIndex: "96", opacity: "0", filter: "drop-shadow(0 14px 22px rgb(0 0 0 / .55))" }, PLANE);
  const tag = el("div", { left: `${cx + 34}px`, top: `${cy - 12}px`, zIndex: "96", opacity: "0", background: "#ffffff", color: "#0b0b0b", font: "600 13px/1 system-ui, sans-serif", padding: "7px 11px", borderRadius: "999px", whiteSpace: "nowrap", boxShadow: "0 8px 20px rgb(0 0 0 / .4)" });
  tag.textContent = "Picking an agent…";
  let hover: Animation | null = null;
  let tagBob: Animation | null = null;
  const ready = fold.finished.then(() => {
    sheet.remove();
    plane.style.opacity = "1";
    tag.style.opacity = "1";
    if (reduce) return;
    plane.animate([{ transform: "scale(.2) rotate(-40deg)" }, { transform: "scale(1) rotate(0deg)" }], { duration: 260, easing: "cubic-bezier(.2,1.4,.4,1)" });
    hover = plane.animate(
      [
        { transform: "translate(0,0) rotate(-6deg)" },
        { transform: "translate(18px,-14px) rotate(8deg)" },
        { transform: "translate(0,-24px) rotate(-4deg)" },
        { transform: "translate(-18px,-12px) rotate(-14deg)" },
        { transform: "translate(0,0) rotate(-6deg)" },
      ],
      { duration: 1600, iterations: Infinity, easing: "ease-in-out", delay: 260 },
    );
    tagBob = tag.animate([{ transform: "translateY(0)" }, { transform: "translateY(-10px)" }, { transform: "translateY(0)" }], { duration: 1600, iterations: Infinity, easing: "ease-in-out" });
  });

  const cleanup = () => {
    hover?.cancel();
    tagBob?.cancel();
    sheet.remove();
    plane.remove();
    tag.remove();
  };

  return {
    abort() {
      void ready.then(async () => {
        hover?.cancel();
        tagBob?.cancel();
        tag.remove();
        await plane.animate([{ transform: "none", opacity: 1 }, { transform: "translateY(120px) rotate(70deg)", opacity: 0 }], { duration: 500, easing: "ease-in", fill: "forwards" }).finished;
        cleanup();
      });
    },
    async land(to, agent) {
      await ready;
      hover?.cancel();
      tagBob?.cancel();
      tag.textContent = agent;
      const target = to ?? new DOMRect(window.innerWidth - 200, 120, 160, 120);
      const tx = target.left + target.width / 2;
      const ty = target.top + Math.min(target.height / 2, 160);
      if (reduce) {
        cleanup();
        return;
      }
      const dx = tx - cx;
      const dy = ty - cy;
      // A wide arc: up and out first, then down onto the pane.
      const lift = -Math.max(220, Math.hypot(dx, dy) * 0.55);
      const side = dx >= 0 ? 1 : -1;
      const at = (t: number) => ({ x: dx * t + side * 140 * Math.sin(Math.PI * t) * (1 - t), y: dy * t + lift * 4 * t * (1 - t) });
      const N = 24;
      const frames = Array.from({ length: N + 1 }, (_, i) => {
        const t = i / N;
        const p = at(t);
        const q = at(Math.min(1, t + 0.02));
        const angle = (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI + 45;
        const scale = 1 + 0.25 * Math.sin(Math.PI * t) - 0.45 * t * t;
        return { transform: `translate(${p.x}px, ${p.y}px) rotate(${angle}deg) scale(${scale})`, opacity: t > 0.92 ? 0 : 1 };
      });

      // Dotted trail drawn behind the plane.
      const svg = el("div", { left: "0", top: "0", width: "100vw", height: "100vh", zIndex: "95" });
      const pts = Array.from({ length: 40 }, (_, i) => at(i / 39)).map((p) => `${cx + p.x},${cy + p.y}`);
      svg.innerHTML = `<svg width="100%" height="100%"><polyline points="${pts.join(" ")}" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="2" stroke-dasharray="2 9" stroke-linecap="round" pathLength="1000" style="stroke-dashoffset:1000"/></svg>`;
      const line = svg.querySelector("polyline")!;
      line.style.strokeDasharray = "1000";
      const draw = line.animate([{ strokeDashoffset: 1000 }, { strokeDashoffset: 0 }], { duration: 1300, easing: "cubic-bezier(.45,0,.25,1)", fill: "forwards" });
      const tagFly = tag.animate(
        frames.map((f, i) => ({ transform: f.transform.replace(/ rotate\([^)]*\)/, "").replace(/scale\([^)]*\)/, ""), opacity: i / N > 0.8 ? 0 : 1 })),
        { duration: 1300, easing: "cubic-bezier(.45,0,.25,1)", fill: "forwards" },
      );
      await plane.animate(frames, { duration: 1300, easing: "cubic-bezier(.45,0,.25,1)", fill: "forwards" }).finished;
      void draw.finished.then(() => svg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: "forwards" }).finished.then(() => svg.remove()));
      tagFly.cancel();
      cleanup();

      // Landing: the pane flashes and a ring spreads out from it.
      const ring = el("div", { left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`, height: `${target.height}px`, zIndex: "94", borderRadius: "10px", border: "2px solid #4c8dff" });
      await ring.animate(
        [
          { boxShadow: "0 0 0 0 rgb(76 141 255 / .7), inset 0 0 60px rgb(76 141 255 / .35)", opacity: 1 },
          { boxShadow: "0 0 0 28px rgb(76 141 255 / 0), inset 0 0 0 rgb(76 141 255 / 0)", opacity: 0 },
        ],
        { duration: 900, easing: "ease-out", fill: "forwards" },
      ).finished;
      ring.remove();
    },
  };
}
