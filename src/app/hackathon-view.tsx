"use client";

import { Wait } from "@/components/wait";
import Link from "next/link";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ArrowRight, CircleStop, Flag, Lightbulb, PencilLine, Play, Rocket } from "lucide-react";
import { LivePreview, StepList, WhereNow, byTime, currentStep, isActive, useNow } from "@/components/build-live";
import { Checkpoints } from "@/components/checkpoints";
import { ReadyCheck } from "@/components/ready-check";
import { TalkPanel } from "@/components/talk-panel";
import { QuestionDock } from "@/components/question-dock";
import { FailureHelp } from "./runs/[id]/run-detail";
import { Button, Dialog, Segmented, Spinner, Toast, cx, inputClass } from "@/components/ui";
import { useWorkspace } from "@/components/workspace-context";
import { api, useApi } from "@/lib/client";
import { HACK_DOCS, type HackDoc } from "@/lib/hackathon-docs";
import { parseScores, timeLeft, type Hackathon } from "@/lib/modes";
import type { Session, Workflow } from "@/lib/types";

const DEFAULT_RUBRIC = "Learning\nDesign\nCreativity\nFunctionality\nImpact";
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function Setup() {
  const { reloadSettings, reloadProjects } = useWorkspace();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ name: "", theme: "", rubric: DEFAULT_RUBRIC, idea: "", ends: "", run: "" as "" | "yes" | "no" });
  const [busy, setBusy] = useState<"" | "ideas" | "start">("");
  const [ideas, setIdeas] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setF((x) => ({ ...x, ends: x.ends || localInput(new Date(Date.now() + 48 * 3_600_000)) }));
  }, []);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const futureEnd = !!f.ends && !Number.isNaN(Date.parse(f.ends));
  const ok = [f.name.trim().length > 1 && futureEnd, f.rubric.trim().length > 2, f.idea.trim().length > 4, f.run !== ""][step];
  const titles = ["Which hackathon?", "How is it judged?", "What will you build?", "Ready to build"];

  const getIdeas = async (quiet = false) => {
    if (!quiet) setBusy("ideas");
    setError(null);
    try {
      const r = (await api<{ ideas: string[] }>("/api/hackathon", { body: { action: "ideas", name: f.name, theme: f.theme, rubric: f.rubric } })).ideas;
      setIdeas(r);
    } catch (e) {
      if (!quiet) setError((e as Error).message);
    } finally {
      setBusy((b) => (b === "ideas" ? "" : b));
    }
  };
  const start = async () => {
    setBusy("start");
    setError(null);
    try {
      await api("/api/hackathon", { body: { action: "start", name: f.name, theme: f.theme, rubric: f.rubric, idea: f.idea, endsAt: new Date(f.ends).toISOString(), runCommands: f.run === "yes" } });
      await Promise.all([reloadSettings(), reloadProjects()]);
    } catch (e) {
      setError((e as Error).message);
      setBusy("");
    }
  };
  const big = cx(inputClass, "px-4 py-3 text-[16px]");
  const asking = step >= 2 && f.idea.trim().length > 14;
  return (
    <div className={cx("mx-auto grid max-w-6xl items-center gap-8", asking && "lg:grid-cols-[1fr_22rem]")}>
    <form
      className="mx-auto flex min-h-[calc(100svh-9rem)] w-full max-w-3xl flex-col justify-center gap-6 py-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        if (step < 3) {
          // Ideas get ready while the criteria step is still being left.
          if (step === 1 && !ideas.length && !f.idea.trim()) void getIdeas(true);
          setStep(step + 1);
        }
        else void start();
      }}
    >
      <p className="font-mono text-[12px] text-ink-2">Hackathon setup, {step + 1} of 4</p>
      <h2 className="font-display text-[38px] leading-[1.05] text-ink sm:text-[52px]">{titles[step]}</h2>
      <div data-tour="hackathon" className="flex flex-col gap-4">
        {step === 0 && (
          <>
            <label className="flex flex-col gap-1.5 text-[14px] text-ink-2">
              Name
              <input autoFocus className={big} value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} />
            </label>
            <label className="flex flex-col gap-1.5 text-[14px] text-ink-2">
              Theme, if it has one
              <input className={big} value={f.theme} onChange={(e) => set({ theme: e.target.value })} maxLength={500} />
            </label>
            <label className="flex flex-col gap-1.5 text-[14px] text-ink-2">
              Ends (your local time)
              <input type="datetime-local" className={big} value={f.ends} onChange={(e) => set({ ends: e.target.value })} />
            </label>
          </>
        )}
        {step === 1 && (
          <label className="flex flex-col gap-1.5 text-[14px] text-ink-2">
            Paste the judging criteria and any must-follow rules
            <textarea autoFocus rows={9} className={big} value={f.rubric} onChange={(e) => set({ rubric: e.target.value })} maxLength={6000} />
          </label>
        )}
        {step === 2 && (
          <>
            <label className="flex flex-col gap-1.5 text-[14px] text-ink-2">
              Who is it for, and what does it do?
              <textarea autoFocus rows={5} className={big} value={f.idea} onChange={(e) => set({ idea: e.target.value })} maxLength={4000} />
            </label>
            <Button onClick={() => getIdeas()} disabled={!!busy} className="self-start">
              {busy === "ideas" ? <Spinner /> : <Lightbulb size={15} aria-hidden />} Suggest ideas on this computer
            </Button>
            {busy === "ideas" && <Wait kind="ideas" className="py-2" label="Looking for ideas on this computer. You can keep typing." />}
            {(!f.idea.trim() || ideas.includes(f.idea) ? ideas : []).map((i) => (
              <button key={i} type="button" onClick={() => set({ idea: i })} className={cx("rounded-[var(--radius-control)] border p-3 text-left text-[14px] text-ink hover:border-line-strong", f.idea === i ? "border-ink" : "border-line")}>
                {i}
              </button>
            ))}
          </>
        )}
        {step === 3 && (
          <>
            <p className="max-w-2xl text-[16px] text-ink">
              Nexus makes a new folder and runs six steps: PRD, build, test, polish, submission, judge. The steps use your agents&apos; own plans and can use a lot of a usage limit. Your installed skills are available to every step.
            </p>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-[15px] text-ink">May agents run commands while they build?</legend>
              {(
                [
                  ["yes", "Yes, run commands", "Install packages, run tests and use the web. Claude Code commands run as you on this Mac."],
                  ["no", "No, files only", "A static site. Claude Code runs no commands. Codex keeps its own sandboxed shell."],
                ] as const
              ).map(([v, t, b]) => (
                <label key={v} className={cx("cursor-pointer rounded-[var(--radius-panel)] border p-4 has-[:focus-visible]:outline has-[:focus-visible]:outline-2", f.run === v ? "border-ink bg-surface-2" : "border-line hover:border-line-strong")}>
                  <input type="radio" name="run" className="sr-only" checked={f.run === v} onChange={() => set({ run: v })} />
                  <span className="block text-[16px] text-ink">{t}</span>
                  <span className="mt-1 block text-[13px] text-ink-2">{b}</span>
                </label>
              ))}
            </fieldset>
          </>
        )}
      </div>
      {busy === "start" && <Wait kind="send" label="Making the project folder and sending out the agents." />}
      {error && (
        <p role="alert" className="text-[14px] text-bad">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        {step > 0 && (
          <Button size="lg" onClick={() => setStep(step - 1)} disabled={busy === "start"}>
            <ArrowLeft size={15} aria-hidden /> Back
          </Button>
        )}
        <Button type="submit" size="lg" variant="primary" disabled={!ok || busy === "start"}>
          {busy === "start" ? <Spinner /> : step === 3 ? <Rocket size={15} aria-hidden /> : null} {step === 3 ? "Build it" : "Next"} {step < 3 && <ArrowRight size={15} aria-hidden />}
        </Button>
      </div>
    </form>
    {asking && <QuestionDock id="draft-hackathon" goal={f.idea.trim()} kind="hackathon" live />}
    </div>
  );
}

function Countdown({ endsAt, onZero }: { endsAt: string; onZero: () => void }) {
  const now = useNow(true);
  const over = now > 0 && now >= Date.parse(endsAt);
  useEffect(() => {
    if (over) onZero();
  }, [over, onZero]);
  return (
    <p className="text-right" role="timer" aria-label="Time left">
      <span className="tabular block font-mono text-[34px] leading-none tracking-tight text-white sm:text-[52px]">{now ? timeLeft(endsAt, now) : "--:--:--"}</span>
      <span className="text-[13px] text-white/65">left</span>
    </p>
  );
}

type Tab = HackDoc | "score" | "ready";

function Documents({ judge, live }: { judge: Session | undefined; live: boolean }) {
  const res = useApi<{ docs: Record<HackDoc, string | null> }>("/api/hackathon/doc", { interval: live ? 5000 : 0 });
  const docs = res.data?.docs;
  const [edit, setEdit] = useState<{ doc: HackDoc; was: string; text: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const save = async () => {
    if (!edit) return;
    try {
      await api("/api/hackathon/doc", { method: "PUT", body: edit });
      setEdit(null);
      setSaveError(null);
      await res.reload();
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };
  const [tab, setTab] = useState<Tab>("prd");
  const scores = parseScores(judge?.summary);
  const text = tab === "score" || tab === "ready" ? null : docs?.[tab];
  return (
    <section data-tour="docs" aria-label="Documents" className="panel flex max-h-[46rem] min-h-80 flex-col overflow-hidden">
      <div className="border-b border-line p-3">
        <Segmented size="sm" label="Document" value={tab} onChange={(t) => { setTab(t); setEdit(null); setSaveError(null); }} options={[...(Object.keys(HACK_DOCS) as HackDoc[]).map((d) => ({ value: d as Tab, label: HACK_DOCS[d].label })), { value: "score" as Tab, label: "Scorecard" }, { value: "ready" as Tab, label: "Ready?" }]} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        {tab === "ready" ? (
          <ReadyCheck live={live} />
        ) : tab === "score" ? (
          scores.length ? (
            <>
              <p className="mb-4 text-[13px] text-ink-2">An AI reviewer&apos;s estimate, not the judges&apos; scores.</p>
              <ul className="flex flex-col gap-4">
                {scores.map((s) => (
                  <li key={s.criterion}>
                    <div className="flex items-baseline justify-between gap-3 text-[15px] text-ink">
                      <span>{s.criterion}</span>
                      <span className="tabular font-mono">{s.score}/10</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
                      <div className="h-full bg-ink" style={{ width: `${s.score * 10}%` }} />
                    </div>
                    <p className="mt-1.5 text-[13px] text-ink-2">{s.why}</p>
                    {s.fix && <p className="text-[13px] text-ink">Next: {s.fix}</p>}
                  </li>
                ))}
              </ul>
            </>
          ) : judge?.summary ? (
            <div className="prose-nexus">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{judge.summary}</ReactMarkdown>
            </div>
          ) : (
            live ? (
            <Wait kind="judge" className="py-8" label="Scores appear after the Judge it step." />
          ) : (
            <p className="text-[14px] text-ink-2">There are no scores yet.</p>
          )
          )
        ) : edit ? (
          <div className="flex h-full min-h-96 flex-col gap-3">
            <textarea aria-label="Edit this document" value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} className={cx(inputClass, "min-h-80 flex-1 resize-none font-mono text-[13px]")} />
            {saveError && (
              <p role="alert" className="text-[13px] text-bad">
                {saveError}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="primary" onClick={save}>
                Save
              </Button>
              <Button onClick={() => setEdit(null)}>Cancel</Button>
            </div>
          </div>
        ) : text ? (
          <div className="prose-nexus relative">
            <Button size="sm" className="float-right ml-3" onClick={() => setEdit({ doc: tab as HackDoc, was: text, text })}>
              <PencilLine size={13} aria-hidden /> Edit
            </Button>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        ) : (
          live ? (
          <Wait kind="write" className="py-8" label={`The ${tab === "judges" ? "judge Q&A" : HACK_DOCS[tab as HackDoc].label} is on its way.`} />
        ) : (
          <p className="text-[14px] text-ink-2">This document was not written.</p>
        )
        )}
      </div>
    </section>
  );
}

function Mission({ h }: { h: Hackathon }) {
  const { agents, reloadSettings } = useWorkspace();
  const wf = useApi<{ workflow: Workflow; sessions: Session[] }>(h.workflowId ? `/api/workflows/${h.workflowId}` : null, { interval: 2500 });
  const [end, setEnd] = useState(false);
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const notify = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 4000);
  };
  const all = [...(wf.data?.sessions ?? [])].sort(byTime);
  const steps = all.filter((s) => s.role !== "revise");
  const cur = currentStep(all);
  const live = all.some(isActive);
  const built = [...all].reverse().find((s) => s.permissions.editFiles && s.startedAt);
  const hack = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api("/api/hackathon", { body });
      setEnd(false);
      await reloadSettings();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const run = async (action: "stop" | "resume") => {
    await hack({ action });
    await wf.reload();
  };
  const act = async (body: Record<string, unknown>) => {
    if (!cur) return;
    setBusy(true);
    try {
      await api(`/api/sessions/${cur.id}/action`, { body });
      await wf.reload();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (wf.error && !wf.data) return <p className="text-bad">{wf.error}</p>;
  return (
    <div className="flex flex-col gap-4">
      <header data-tour="hackathon" className="page-sky flex flex-wrap items-end gap-5 overflow-hidden rounded-[var(--radius-panel)] border border-white/15 p-5 text-white sm:p-7">
        <div className="min-w-0 flex-1 basis-72">
          <p className="text-[14px] text-white/70">{h.name}</p>
          <h2 className="font-display mt-2 line-clamp-2 max-w-3xl text-[26px] leading-[1.1] sm:text-[38px]">{h.idea}</h2>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setWhen(localInput(new Date(h.endsAt)));
                setEnd(true);
              }}
            >
              <Flag size={14} aria-hidden /> Deadline or end
            </Button>
            {live ? (
              <Button variant="danger" disabled={busy} onClick={() => run("stop")}>
                <CircleStop size={14} aria-hidden /> Stop building
              </Button>
            ) : (
              all.some((s) => s.status === "cancelled") && (
                <Button variant="primary" disabled={busy} onClick={() => run("resume")}>
                  <Play size={14} aria-hidden /> Resume building
                </Button>
              )
            )}
            {h.workflowId && <Checkpoints workflow={h.workflowId} live={all.some((s) => s.status === "running" || s.status === "starting")} onRestored={wf.reload} />}
            {h.workflowId && (
              <Link href={`/runs/${h.workflowId}`} className="btn-step inline-flex h-[34px] items-center rounded-[var(--radius-control)] border border-white/20 px-3.5 font-mono text-[12px] text-white hover:bg-white/10">
                Full run
              </Link>
            )}
          </div>
        </div>
        <Countdown endsAt={h.endsAt} onZero={reloadSettings} />
      </header>
      {!wf.data ? <Wait kind="open" label="Loading the build" /> : <StepList sessions={steps} />}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
        <LivePreview session={built} live={live} className="min-h-[32rem]" />
        <div className="flex min-w-0 flex-col gap-4">
          {(live ? all.filter((s) => s.status === "running" || s.status === "starting") : []).slice(0, 2).map((s) => (
            <WhereNow key={s.id} sessions={all} focus={s.id} showSteps={false} />
          ))}
          {!all.some((s) => s.status === "running" || s.status === "starting") && <WhereNow sessions={all} showSteps={false} />}
          {h.workflowId && <TalkPanel workflow={h.workflowId} current={live && cur?.startedAt ? cur : built} live={live} name="the agent" canPoint />}
          {h.workflowId && <QuestionDock id={h.workflowId} kind="hackathon" live={live} />}
          {cur?.error && cur.status === "failed" && (
            <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line">
              <FailureHelp s={cur} agent={agents.find((a) => a.id === cur.agentId)} agents={agents} busy={busy} onRetry={() => act({ action: "retry" })} onMove={(agentId) => act({ action: "reassign", agentId })} notify={notify} />
            </div>
          )}
        </div>
      </div>
      <Documents judge={steps.find((s) => s.role === "review")} live={live} />
      <Dialog open={end} onClose={() => setEnd(false)} title="Deadline or end">
        <label className="flex flex-col gap-1.5">
          Ends (your local time)
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={inputClass} />
        </label>
        <Button className="mt-2" disabled={busy || !when} onClick={() => hack({ action: "deadline", endsAt: new Date(when).toISOString() })}>
          Save deadline
        </Button>
        <p className="mt-6 mb-2 border-t border-line pt-4">Ending closes this screen. Your files stay, and steps still working keep going. Stop building first if you want them to stop. Open next:</p>
        <div className="flex gap-2">
          <Button variant="primary" disabled={busy} onClick={() => hack({ action: "end", next: "advanced" })}>
            End, use Advanced
          </Button>
          <Button disabled={busy} onClick={() => hack({ action: "end", next: "beginner" })}>
            End, use Beginner
          </Button>
        </div>
      </Dialog>
      <Toast message={toast} />
    </div>
  );
}

export function HackathonView() {
  const { settings } = useWorkspace();
  const h = settings?.hackathon;
  return h && !h.endedAt ? <Mission h={h} /> : <Setup />;
}
