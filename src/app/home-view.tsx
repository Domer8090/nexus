"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Play } from "lucide-react";
import { AgentMark, AuthBadge, InstallBadge, SessionBadge } from "@/components/agent-bits";
import { cx } from "@/components/ui";
import { useWorkspace } from "@/components/workspace-context";
import { timeAgo, useApi } from "@/lib/client";
import { tidyPath } from "@/lib/format";
import type { AgentStatus, PresetId, Session } from "@/lib/types";
import { FolderPicker } from "./projects/projects-view";
import { MosaicSky, PixelText } from "@/components/mosaic";

const PRESETS: { id: PresetId; title: string; body: string }[] = [
  { id: "swarm", title: "Team build", body: "Every agent on its best job" },
  { id: "solo", title: "Solo", body: "One agent, start to finish" },
  { id: "plan-build-review", title: "Plan, build, review", body: "Three roles, one pipeline" },
  { id: "debug-test", title: "Debug and test", body: "Root cause, fix, verify" },
  { id: "frontend-polish", title: "Frontend polish", body: "Design, build, check" },
];

const EXAMPLES = [
  "A website to track my sleep, with a weekly chart and a bedtime goal",
  "Fix the failing signup test and tell me what broke",
  "A landing page for my science club with events and a join form",
  "An API that turns a CSV of expenses into a monthly report",
];

/** Types example goals into the empty composer and deletes them again. Static under reduced motion. */
function useTypedExample(active: boolean) {
  const [text, setText] = useState(EXAMPLES[0]);
  useEffect(() => {
    if (!active || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    let n = 0;
    let dir = 1;
    let t = 0;
    const tick = () => {
      const full = EXAMPLES[i];
      n += dir;
      setText(full.slice(0, n));
      if (dir > 0 && n >= full.length) {
        dir = -1;
        t = window.setTimeout(tick, 1800);
        return;
      }
      if (dir < 0 && n <= 0) {
        dir = 1;
        i = (i + 1) % EXAMPLES.length;
      }
      t = window.setTimeout(tick, dir > 0 ? 38 : 16);
    };
    t = window.setTimeout(tick, 600);
    return () => window.clearTimeout(t);
  }, [active]);
  return text;
}

const ready = (a: AgentStatus) => a.integration === "supported" && a.install === "installed" && (a.auth === "authenticated" || a.auth === "not-required");

function Onboarding({ onPick }: { onPick: () => void }) {
  const { agents, projects } = useWorkspace();
  const sys = useApi<{ os: string; shell: string; node: string; git: string | null }>("/api/system");
  const anyReady = agents.some((a) => ready(a) && a.nexusCapabilities.includes("edits-project"));
  const steps = [
    { done: true, title: "Local-first, no API keys", body: "Nexus runs on 127.0.0.1 and drives the agents you already installed, with their own sign-in." },
    { done: !!sys.data, title: "Your machine", body: sys.data ? `${sys.data.os}, ${sys.data.shell}, Node ${sys.data.node}, git ${sys.data.git ?? "not found"}` : "Detecting…" },
    { done: anyReady, title: "A signed-in coding agent", body: anyReady ? "Ready." : "Install one and sign in with its own command.", href: "/agents", cta: "Open Agents" },
    { done: projects.length > 0, title: "A project folder", body: projects.length ? `${projects.length} added.` : "Pick a local repository to work in.", action: onPick, cta: "Choose folder" },
    { done: false, title: "Optional: starter skills", body: "Inspect curated skills one by one before installing.", href: "/skills", cta: "Browse collections", optional: true },
  ];
  const todo = steps.filter((x) => !x.done && !x.optional);
  const next = todo[0];
  if (!next) return null;
  const doneCount = steps.filter((x) => x.done && !x.optional).length;
  const total = steps.filter((x) => !x.optional).length;
  return (
    <section aria-labelledby="onb" className="panel flex flex-wrap items-center gap-3 p-4 sm:p-5">
      <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line-strong font-mono text-[12px] text-ink-2">{doneCount + 1}</span>
      <div className="min-w-0 flex-1">
        <h2 id="onb" className="text-[14px] font-semibold text-ink">
          Set up Nexus: {next.title.toLowerCase()}
        </h2>
        <p className="text-[12.5px] text-ink-2">
          {next.body} Step {doneCount + 1} of {total}.
        </p>
      </div>
      {next.href ? (
        <Link href={next.href} className="btn-step inline-flex h-9 items-center rounded-[var(--radius-control)] border border-ink bg-ink px-3.5 font-mono text-[11.5px] font-semibold text-canvas">
          {next.cta}
        </Link>
      ) : (
        <button onClick={next.action} className="btn-step inline-flex h-9 items-center rounded-[var(--radius-control)] border border-ink bg-ink px-3.5 font-mono text-[11.5px] font-semibold text-canvas">
          {next.cta}
        </button>
      )}
    </section>
  );
}

export function HomeView() {
  const router = useRouter();
  const { project, projects, agents, reloadProjects, setProjectId } = useWorkspace();
  const [goal, setGoal] = useState("");
  const [picker, setPicker] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [preset, setPreset] = useState<PresetId>("swarm");
  const [focused, setFocused] = useState(false);
  const typed = useTypedExample(!goal && !focused);
  const sessions = useApi<{ sessions: Session[] }>(`/api/sessions${project ? `?projectId=${project.id}` : ""}`, { interval: 4000 });
  const recent = sessions.data?.sessions.slice(0, 5) ?? [];
  const running = recent.filter((s) => s.status === "running" || s.status === "starting" || s.status === "queued");
  const installed = agents.filter((a) => a.install === "installed");
  const setupNeeded = !projects.length || !agents.some((a) => ready(a) && a.nexusCapabilities.includes("edits-project"));

  const go = () => {
    if (!goal.trim()) {
      setHint("Describe what you want built first.");
      document.getElementById("home-goal")?.focus();
      return;
    }
    try {
      window.sessionStorage.setItem("nexus.goal", goal.trim());
      window.sessionStorage.setItem("nexus.preset", preset);
    } catch {}
    router.push("/playground");
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <section aria-labelledby="home-title" className="force-dark relative -mx-3 -mt-5 overflow-hidden border-b border-line sm:-mx-4 lg:-mx-6">
        <MosaicSky />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgb(0_0_0/0.35),transparent_35%,rgb(0_0_0/0.75))]" />
        <div className="relative mx-auto flex min-h-[min(640px,82svh)] max-w-5xl flex-col justify-end px-4 pt-16 pb-8 sm:px-6 sm:pb-10">
          <p className="mb-5 font-mono text-[12px] text-white/60">{project ? `${project.name}  ${tidyPath(project.path)}` : "No project selected"}</p>
          <h2 id="home-title" className="sr-only">
            Describe it. Agents build it.
          </h2>
          <div className="w-full max-w-[640px] text-white">
            <PixelText text="Describe it." className="w-[78%]" />
            <PixelText text="Agents build it." line={1} className="mt-[1.4%] w-full text-white/50" />
          </div>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed font-light text-white/70">Your installed coding agents and a local model plan, build and review it together. On this computer, with their own sign-in.</p>

          <div className="mt-7 w-full max-w-3xl rounded-[var(--radius-panel)] border border-white/15 bg-black/60 p-3 backdrop-blur-xl focus-within:border-white/40">
            <label htmlFor="home-goal" className="sr-only">
              Describe what you want built
            </label>
            <div className="relative">
              <textarea
                id="home-goal"
                value={goal}
                onChange={(e) => {
                  setGoal(e.target.value);
                  setHint(null);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    go();
                  }
                }}
                rows={3}
                className="relative z-10 w-full resize-none bg-transparent px-1 py-1 font-mono text-[14px] leading-relaxed text-white focus:outline-none"
              />
              {!goal && (
                <p aria-hidden className={cx("pointer-events-none absolute inset-0 px-1 py-1 font-mono text-[14px] leading-relaxed text-white/35", !focused && "caret")}>
                  {focused ? "Describe what you want built…" : typed}
                </p>
              )}
            </div>
            <div role="radiogroup" aria-label="How to build it" className="mt-2 flex flex-wrap gap-1.5 border-t border-white/10 pt-3">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={preset === p.id}
                  title={p.body}
                  onClick={() => setPreset(p.id)}
                  className={cx(
                    "h-7 rounded-[var(--radius-chip)] border px-2.5 font-mono text-[11.5px] transition-colors",
                    preset === p.id ? "border-white bg-white text-black" : "border-white/15 bg-white/5 text-white/75 hover:border-white/30 hover:bg-white/10",
                  )}
                >
                  {p.title}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className={cx("min-w-0 basis-full text-[12px] sm:flex-1 sm:basis-auto", hint ? "text-warn" : "text-white/45")} role={hint ? "alert" : undefined}>
                {hint ?? `${PRESETS.find((p) => p.id === preset)?.body}. Enter goes to the questions, Shift+Enter adds a line. Nothing runs until you approve.`}
              </span>
              <span className="btn-pair flex">
                <button type="button" onClick={go} className="btn-step inline-flex h-[34px] items-center gap-1.5 rounded-[var(--radius-control)] border border-white bg-white px-3.5 font-mono text-[11.5px] font-semibold tracking-[0.06em] text-black hover:bg-white/90">
                  Continue to questions <ArrowRight size={13} aria-hidden />
                </button>
                <Link href="/playground" className="btn-step inline-flex h-[34px] items-center rounded-[var(--radius-control)] border border-white/30 bg-white/10 px-3.5 font-mono text-[11.5px] font-semibold tracking-[0.06em] text-white backdrop-blur-sm hover:bg-white/20">
                  Playground
                </Link>
              </span>
            </div>
          </div>
        </div>
      </section>

      {setupNeeded && <Onboarding onPick={() => setPicker(true)} />}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="act" className="panel p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <span className="eyebrow">Activity</span>
              <h2 id="act" className="font-display mt-2 text-[22px] leading-tight">
                {running.length ? `${running.length} sessions running` : "Recent sessions"}
              </h2>
            </div>
            <Link href="/runs" className="text-[12.5px] text-ink-3 hover:text-accent">
              All runs
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-[13px] text-ink-2">No sessions yet{project ? ` in ${project.name}` : ""}. Describe a goal above to start one.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {recent.map((s) => {
                const a = agents.find((x) => x.id === s.agentId);
                return (
                  <li key={s.id}>
                    <Link href={s.workflowId ? `/runs/${s.workflowId}` : "/runs"} className="flex items-center gap-2.5 py-2 hover:text-accent">
                      {a ? <AgentMark agent={a} size="sm" /> : <Play size={14} aria-hidden />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink">{s.title}: {s.brief.replace(/^#+.*\n/, "").split("\n").find(Boolean)?.slice(0, 80)}</span>
                        <span className="text-[11.5px] text-ink-3">{timeAgo(s.createdAt)}</span>
                      </span>
                      <SessionBadge status={s.status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="fleet" className="panel p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <div>
              <span className="eyebrow">Fleet</span>
              <h2 id="fleet" className="font-display mt-2 text-[22px] leading-tight">
                Agents on this machine
              </h2>
            </div>
            <Link href="/agents" className="text-[12.5px] text-ink-3 hover:text-accent">
              Fleet
            </Link>
          </div>
          <ul className="flex flex-col gap-2.5">
            {installed.map((a) => (
              <li key={a.id} className="flex items-center gap-2.5">
                <AgentMark agent={a} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{a.displayName}</span>
                <AuthBadge a={a} />
              </li>
            ))}
            {agents
              .filter((a) => a.install !== "installed")
              .slice(0, Math.max(0, 5 - installed.length))
              .map((a) => (
                <li key={a.id} className="flex items-center gap-2.5 opacity-70">
                  <AgentMark agent={a} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{a.displayName}</span>
                  <InstallBadge a={a} />
                </li>
              ))}
          </ul>
        </section>
      </div>

      <FolderPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPicked={async (p) => {
          setPicker(false);
          await reloadProjects();
          setProjectId(p.id);
        }}
      />
    </div>
  );
}
