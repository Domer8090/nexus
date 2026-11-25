"use client";

import { Wait } from "@/components/wait";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, Check, CircleDashed, ExternalLink, FolderOpen, MousePointerClick, PencilLine } from "lucide-react";
import { usePicker } from "@/components/use-picker";
import { useWorkspace } from "@/components/workspace-context";
import { Button, Spinner, cx } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { useSessionStream } from "@/lib/live";
import type { Session } from "@/lib/types";
import { actionsOf, planOf, trailOf, whereIs } from "@/lib/where";

/** Shared pieces that show a build while it happens: where the agent is, and the live page. */

export const isActive = (s: Session) => s.status === "running" || s.status === "starting" || s.status === "queued";
export const byTime = (a: Session, b: Session) => a.createdAt.localeCompare(b.createdAt);

/** The step to watch: the one running, else the next waiting, else a failure, else the last. */
export function currentStep(sessions: Session[]): Session | undefined {
  const o = [...sessions].sort(byTime);
  return o.find((s) => s.status === "running" || s.status === "starting") ?? o.find((s) => s.status === "failed" && !s.optional) ?? o.find((s) => s.status === "queued") ?? o.find((s) => s.status === "cancelled") ?? o.at(-1);
}

export function useNow(active: boolean) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return now;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Header chip on every page while an agent works. */
export function LiveChip({ session }: { session: Session }) {
  const { agents, settings } = useWorkspace();
  const { events } = useSessionStream(session.id);
  const w = whereIs(events, session.cwd);
  const name = agents.find((a) => a.id === session.agentId)?.displayName ?? session.agentId;
  const text = w ? `${w.verb}${w.target ? ` ${w.target}` : ""}` : "Starting";
  return (
    <Link data-tour="live" href={settings?.mode === "advanced" ? "/advanced" : session.workflowId ? `/runs/${session.workflowId}` : "/runs"} title={`${name}: ${text}`} aria-label={`${name} is working on ${session.title}. Open the run.`} className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-line px-2.5 py-1 font-mono text-[11.5px] text-ink-2 hover:border-line-strong hover:text-ink">
      <span className="live-dot size-1.5 shrink-0 rounded-full bg-ok text-ok" aria-hidden />
      <span className="hidden shrink-0 text-ink sm:inline">{name}</span>
      <span className="hidden max-w-[26ch] truncate md:inline">{text}</span>
    </Link>
  );
}

/** Where the agent is: the step, what it is doing this second, and the files it walked through. */
export function WhereNow({ sessions, focus, showSteps = true }: { sessions: Session[]; focus?: string; showSteps?: boolean }) {
  const ordered = [...sessions].sort(byTime);
  const s = (focus && ordered.find((x) => x.id === focus)) || currentStep(ordered);
  return s ? <WhereInner key={s.id} s0={s} ordered={ordered} showSteps={showSteps} /> : null;
}

function WhereInner({ s0, ordered, showSteps }: { s0: Session; ordered: Session[]; showSteps: boolean }) {
  const { agents } = useWorkspace();
  const { events, session } = useSessionStream(s0.id);
  const s = session ?? s0;
  const live = s.status === "running" || s.status === "starting";
  const now = useNow(live);
  const name = agents.find((a) => a.id === s.agentId)?.displayName ?? s.agentId;
  const w = whereIs(events, s.cwd);
  const trail = trailOf(events, s.cwd, 5);
  const plan = planOf(events, live);
  const list = plan.length ? plan : actionsOf(events, s.cwd, live);
  const idx = ordered.findIndex((x) => x.id === s.id);
  const start = s.startedAt ? Date.parse(s.startedAt) : 0;
  const end = s.endedAt ? Date.parse(s.endedAt) : now;
  const headline = live
    ? w
      ? `${w.verb}${w.target ? "" : "…"}`
      : "Starting…"
    : s.status === "queued"
      ? s.notice ?? "Waiting to start"
      : s.status === "failed"
        ? "Stopped by a problem"
        : s.status === "cancelled"
          ? "Stopped"
          : "Finished";
  return (
    <section data-tour="where" aria-label="Where the agent is" className="panel flex flex-col p-4">
      <div className="flex items-center gap-2 font-mono text-[12px] text-ink-2">
        <span className={cx("size-2 shrink-0 rounded-full", live ? "live-dot bg-ok text-ok" : s.status === "failed" ? "bg-bad" : "bg-line-strong")} aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {name}, step {idx + 1} of {ordered.length}: {s.title}
        </span>
        {start > 0 && end > 0 && <span className="tabular">{clock(end - start)}</span>}
      </div>
      <p className="font-display mt-3 text-[22px] leading-tight text-ink" aria-live="polite">
        {headline}
      </p>
      {((live && !w) || s.status === "queued") && <Wait kind={s.status === "queued" ? "queue" : "open"} small className="mt-3" label={live ? "Opening the project" : "Waiting for its turn"} />}
      {live && w?.target && <p className="mt-1 line-clamp-3 font-mono text-[13px] break-all text-ink-2">{w.target}</p>}
      {showSteps && ordered.length > 1 && (
        <ol className="mt-4 flex gap-1" aria-label="Steps">
          {ordered.map((x) => (
            <li key={x.id} title={`${x.title}: ${x.status}`} className={cx("h-1.5 flex-1 rounded-full", ["completed", "applied"].includes(x.status) ? "bg-ok" : x.status === "failed" ? "bg-bad" : x.id === s.id && live ? "bg-ink" : "bg-line")}>
              <span className="sr-only">
                {x.title}: {x.status}
              </span>
            </li>
          ))}
        </ol>
      )}
      {list.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-[12px] text-ink-3">{plan.length ? "Its plan" : "Latest steps"}</p>
          <ol className="flex flex-col gap-2.5" aria-label={plan.length ? "The agent's plan" : "Latest steps"}>
            {list.map((t, k) => (
              <li key={`${k}-${t.text}`} className={cx("flex items-start gap-2.5 text-[14px] leading-snug", t.status === "active" ? "text-ink" : "text-ink-2")} aria-current={t.status === "active" ? "step" : undefined}>
                {t.status === "done" ? (
                  <span className="mt-px grid size-[18px] shrink-0 place-items-center rounded-full bg-ink-2 text-canvas">
                    <Check size={12} strokeWidth={3} aria-label="Done" />
                  </span>
                ) : t.status === "active" ? (
                  <Spinner size={18} className="mt-px" />
                ) : (
                  <CircleDashed size={18} className="mt-px shrink-0 text-ink-3" aria-label="Not started" />
                )}
                <span className={cx("min-w-0 break-words", !plan.length && "line-clamp-2 font-mono text-[12.5px]")}>{t.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {plan.length > 0 && trail.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3 font-mono text-[12px]" aria-label="Files, newest first">
          {trail.map((t, k) => (
            <li key={t.file} className={cx("flex items-center gap-2", k === 0 && live ? "text-ink" : "text-ink-3")}>
              {t.kind === "edit" ? <PencilLine size={13} className="shrink-0" aria-label="Edited" /> : <BookOpen size={13} className="shrink-0" aria-label="Read" />}
              <span className="truncate">{t.file}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type View = { url: string | null; devCommand: string | null; framework: string | null; version: number; path: string };

export function LivePreview({ session, live, className }: { session: Session | undefined; live: boolean; className?: string }) {
  const v = useApi<View>(session ? `/api/view?session=${session.id}` : null, { interval: live ? 4000 : 15_000 }).data;
  const [note, setNote] = useState<string | null>(null);
  const { frame: pickFrame, on: pointing, setOn: setPointing } = usePicker(v?.url ?? null, [session?.workflowId, session?.id]);
  return (
    <section data-tour="preview" aria-label="Your project" className={cx("panel flex min-h-[26rem] flex-col overflow-hidden", className)}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-2">{pointing ? "Click what you want changed. Escape cancels." : live ? "Live page" : "Your project"}</span>
        {v?.url && (
          <Button size="sm" variant={pointing ? "primary" : "ghost"} aria-pressed={pointing} onClick={() => setPointing(!pointing)}>
            <MousePointerClick size={14} aria-hidden /> Point at it
          </Button>
        )}
        {session && (
          <Button size="sm" variant="ghost" onClick={() => api("/api/reveal", { body: { sessionId: session.id } }).catch((e: Error) => setNote(e.message))}>
            <FolderOpen size={14} aria-hidden /> Finder
          </Button>
        )}
        {v?.url && (
          <a href={v.url} target="_blank" rel="noreferrer" className="btn-step inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-line px-2.5 font-mono text-[11.5px] text-ink hover:bg-surface-2">
            <ExternalLink size={13} aria-hidden /> Open
          </a>
        )}
      </div>
      {v?.url ? (
        <iframe ref={pickFrame} key={v.version} src={v.url} title="Live page" className="min-h-0 w-full flex-1 bg-white" />
      ) : (
        <div className="grid flex-1 place-items-center p-6 text-center text-ink-2">
          {v?.devCommand && !live ? (
            <p className="max-w-sm text-[14px]">
              This {v.framework ?? "project"} runs with its own server. In Terminal, in its folder, run <code className="font-mono text-ink">{v.devCommand}</code>
            </p>
          ) : live ? (
            <Wait kind="page" className="w-full" label="The page appears here as soon as there is something to open." />
          ) : (
            <p className="text-[14px]">There is no page to show for this project. Open its folder in Finder.</p>
          )}
        </div>
      )}
      {note && <p className="px-3 py-2 text-[12px] text-bad">{note}</p>}
    </section>
  );
}

export function StepList({ sessions }: { sessions: Session[] }) {
  const { agents } = useWorkspace();
  return (
    <ol data-tour="pipeline" className="panel grid overflow-hidden sm:grid-cols-3 xl:grid-cols-6" aria-label="Pipeline">
      {sessions.map((s, i) => {
        const done = ["completed", "applied"].includes(s.status);
        const live = s.status === "running" || s.status === "starting";
        return (
          <li key={s.id} className={cx("flex items-start gap-3 border-line p-4 max-sm:border-b sm:border-r", live && "bg-surface-2")} aria-current={live ? "step" : undefined}>
            <span className={cx("grid size-6 shrink-0 place-items-center rounded-full border font-mono text-[11px]", done ? "border-ok bg-ok text-black" : live ? "border-ink text-ink" : s.status === "failed" ? "border-bad text-bad" : "border-line-strong text-ink-3")}>{done ? <Check size={13} aria-hidden /> : i + 1}</span>
            <span className="min-w-0">
              <span className={cx("block text-[14px] leading-snug", done || live ? "text-ink" : "text-ink-2")}>{s.title}</span>
              <span className="block truncate text-[12px] text-ink-3">{live ? agents.find((a) => a.id === s.agentId)?.displayName ?? s.agentId : s.status === "queued" ? "Waiting" : done ? "Done" : s.status === "failed" ? "Needs you" : "Stopped"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
