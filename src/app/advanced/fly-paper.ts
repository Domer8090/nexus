/**
 * Send animation for "Ask the agents": the request folds into a sheet of paper, turns into a paper
 * plane and flies along an arc to the pane of the agent that got the job, which pulses on arrival.
 * Plain Web Animations on two fixed elements; skipped when the user prefers reduced motion.
 */
export async function flyPaper(from: DOMRect, to: DOMRect | null, text: string, agent: string) {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const target = to ?? new DOMRect(window.innerWidth - 120, 80, 80, 40);

  // 1. The dialog becomes a sheet of paper with the request on it, then folds small.
  const sheet = document.createElement("div");
  Object.assign(sheet.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    zIndex: "95",
    background: "linear-gradient(180deg,#ffffff,#eef1f6)",
    color: "#111",
    borderRadius: "14px",
    padding: "28px",
    font: "500 17px/1.5 var(--font-sans, system-ui)",
    overflow: "hidden",
    boxShadow: "0 30px 80px rgb(0 0 0 / .55)",
    transformOrigin: "50% 50%",
    pointerEvents: "none",
  } as CSSStyleDeclaration);
  sheet.textContent = text.slice(0, 280);
  document.body.append(sheet);
  await sheet.animate(
    [
      { transform: "none", opacity: 1, borderRadius: "14px" },
      { transform: "perspective(900px) rotateX(38deg) scale(.72)", offset: 0.45 },
      { transform: "perspective(900px) rotateX(0deg) rotateZ(-8deg) scale(.16, .1)", borderRadius: "4px", opacity: 1 },
    ],
    { duration: 520, easing: "cubic-bezier(.6,.05,.3,1)", fill: "forwards" },
  ).finished;

  // 2. A paper plane takes off from where the sheet folded and arcs to the agent's pane.
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const tx = target.left + target.width / 2;
  const ty = target.top + Math.min(target.height / 2, 120);
  const plane = document.createElement("div");
  plane.innerHTML = `<svg width="54" height="54" viewBox="0 0 24 24" fill="none"><path d="M22 2 11 13" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/><path d="M22 2 15 22l-4-9-9-4 20-7Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg><span style="position:absolute;left:52px;top:14px;white-space:nowrap;background:#4c8dff;color:#fff;font:600 12px/1 system-ui;padding:5px 8px;border-radius:999px">${agent.replace(/[<>&]/g, "")}</span>`;
  Object.assign(plane.style, { position: "fixed", left: `${cx - 27}px`, top: `${cy - 27}px`, zIndex: "96", pointerEvents: "none", filter: "drop-shadow(0 10px 18px rgb(0 0 0 / .5))" } as CSSStyleDeclaration);
  document.body.append(plane);
  sheet.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" }).finished.then(() => sheet.remove());

  const dx = tx - cx;
  const dy = ty - cy;
  const lift = -Math.max(120, Math.abs(dx) * 0.35);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 45;
  const pts = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    // Quadratic arc: up first, then down onto the pane.
    const x = dx * t;
    const y = dy * t + lift * 4 * t * (1 - t);
    const vx = dx;
    const vy = dy + lift * 4 * (1 - 2 * t);
    const a = (Math.atan2(vy, vx) * 180) / Math.PI + 45;
    return { transform: `translate(${x}px, ${y}px) rotate(${i === 0 ? angle - 30 : a}deg) scale(${1 - t * 0.35})`, opacity: i === 8 ? 0 : 1 };
  });
  await plane.animate(pts, { duration: 950, easing: "cubic-bezier(.45,0,.25,1)", fill: "forwards" }).finished;
  plane.remove();

  // 3. The pane that received it pulses once.
  const ring = document.createElement("div");
  Object.assign(ring.style, { position: "fixed", left: `${target.left}px`, top: `${target.top}px`, width: `${target.width}px`, height: `${target.height}px`, zIndex: "94", borderRadius: "8px", pointerEvents: "none", boxShadow: "0 0 0 2px #4c8dff" } as CSSStyleDeclaration);
  document.body.append(ring);
  await ring.animate(
    [
      { boxShadow: "0 0 0 2px #4c8dff, 0 0 0 0 rgb(76 141 255 / .6)", opacity: 1 },
      { boxShadow: "0 0 0 2px #4c8dff, 0 0 0 18px rgb(76 141 255 / 0)", opacity: 0 },
    ],
    { duration: 700, easing: "ease-out", fill: "forwards" },
  ).finished;
  ring.remove();
}
