"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./ui";
import type { UiMode } from "@/lib/modes";

type Step = { at: string; title: string; body: string };
const MODE_STEP: Step = { at: "mode", title: "Switch modes", body: "Beginner, Advanced or Hackathon. Your projects stay the same in all three." };
const HELP: Step = { at: "help", title: "See this again", body: "Open the tour any time from here." };
export const TOURS: Record<UiMode, Step[]> = {
  beginner: [
    { at: "workspace", title: "Choose a project", body: "Agents work in the project selected here. You can add any folder in your home folder." },
    { at: "composer", title: "Describe what you want", body: "Nexus asks a few questions, then shows the plan. Nothing runs until you approve it." },
    { at: "live", title: "See where the agent is", body: "While it works, this names the file or command it is on. Click it to open the run." },
    { at: "nav", title: "Find everything", body: "Your runs, projects, agents and skills." },
    MODE_STEP,
    HELP,
  ],
  advanced: [
    { at: "sessions", title: "Every session", body: "Pick which ones fill the panes. Filter by name, agent or project." },
    { at: "panes", title: "Live terminals", body: "Each agent's steps, raw output and exact command." },
    { at: "ask", title: "Ask the agents", body: "Describe a change and Nexus sends it to the agent that fits." },
    { at: "live", title: "See where the agent is", body: "The file or command an agent is on right now." },
    MODE_STEP,
    HELP,
  ],
  hackathon: [
    { at: "hackathon", title: "Start with the rules", body: "The name, deadline, judging criteria and idea shape every step of the build." },
    { at: "pipeline", title: "Six steps", body: "PRD, build, test, polish, submission and a strict review." },
    { at: "where", title: "See where the agent is", body: "The file, command and elapsed time of the step that is working." },
    { at: "preview", title: "Watch the project", body: "The page reloads here as files change." },
    { at: "talk", title: "Change anything, any time", body: "Write, paste a screenshot and mark it, or point at the page. The agent reads it without losing its place." },
    { at: "docs", title: "Everything to submit", body: "The PRD, submission, demo script, judge questions and a scorecard." },
    MODE_STEP,
  ],
};

const visible = (at: string) => [...document.querySelectorAll<HTMLElement>(`[data-tour="${at}"]`)].find((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden");

/** Spotlight tour: dims the window, lights one control at a time. Steps not on screen are skipped. */
export function Tour({ mode, onClose }: { mode: UiMode; onClose: () => void }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [card, setCard] = useState({ left: 12, top: 12 });
  const cardRef = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(null);
  const step = steps[i];

  useEffect(() => {
    prev.current = document.activeElement;
    // Let the mode's screen settle before choosing which steps exist on it.
    const t = window.setTimeout(() => {
      const found = TOURS[mode].filter((s) => visible(s.at));
      if (found.length) setSteps(found);
      else onClose();
    }, 500);
    return () => {
      window.clearTimeout(t);
      (prev.current as HTMLElement | null)?.focus?.();
    };
  }, [mode, onClose]);

  const measure = useCallback(() => {
    const el = step && visible(step.at);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    // Tall targets are lit only as far as the window goes.
    const y = Math.max(4, r.top - pad);
    const h = Math.min(window.innerHeight - 4, r.bottom + pad) - y;
    setBox({ x: r.left - pad, y, w: r.width + pad * 2, h });
    const cw = cardRef.current?.offsetWidth ?? 320;
    const ch = cardRef.current?.offsetHeight ?? 180;
    const gap = 14;
    const clampX = (x: number) => Math.min(Math.max(12, x), window.innerWidth - cw - 12);
    const clampY = (v: number) => Math.min(Math.max(12, v), window.innerHeight - ch - 12);
    if (y + h + gap + ch < window.innerHeight) setCard({ left: clampX(r.left), top: y + h + gap });
    else if (y - gap - ch > 12) setCard({ left: clampX(r.left), top: y - gap - ch });
    else if (r.right + gap + cw + 12 < window.innerWidth) setCard({ left: r.right + gap + pad, top: clampY(r.top) });
    else setCard({ left: clampX(r.right - cw - 12), top: clampY(y + h - ch - 12) });
  }, [step]);

  useLayoutEffect(() => {
    if (!step) return;
    const el = visible(step.at);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: r.height > window.innerHeight * 0.7 ? "start" : "center" });
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    measure();
    cardRef.current?.focus();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step, measure]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, steps.length - 1));
      else if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
      else if (e.key === "Tab" && cardRef.current) {
        const b = [...cardRef.current.querySelectorAll("button")];
        const at = b.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        b[(at + (e.shiftKey ? -1 : 1) + b.length) % b.length]?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [steps.length, onClose]);

  if (!step || !box) return step ? createPortal(<div ref={cardRef} className="sr-only" />, document.body) : null;
  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <div aria-hidden className="spot pointer-events-none absolute" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />
      <div ref={cardRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tour-t" aria-describedby="tour-b" className="spot-card absolute w-[min(20rem,calc(100vw-1.5rem))] rounded-[var(--radius-dock)] border border-line-strong bg-surface p-4 text-ink shadow-2xl outline-none" style={card}>
        <p className="font-mono text-[11.5px] text-ink-2">
          {i + 1} of {steps.length}
        </p>
        <h2 id="tour-t" className="font-display mt-1 text-[20px]">
          {step.title}
        </h2>
        <p id="tour-b" className="mt-1 text-[14px] text-ink-2">
          {step.body}
        </p>
        <div className="mt-4 flex gap-2">
          {i + 1 < steps.length && (
            <Button size="sm" variant="ghost" onClick={onClose}>
              Skip
            </Button>
          )}
          {i > 0 && (
            <Button size="sm" className="ml-auto" onClick={() => setI(i - 1)}>
              Back
            </Button>
          )}
          <Button size="sm" variant="primary" className={i === 0 ? "ml-auto" : ""} onClick={() => (i + 1 < steps.length ? setI(i + 1) : onClose())}>
            {i + 1 < steps.length ? "Next" : "Done"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
