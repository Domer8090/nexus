"use client";

import { Picker } from "@/components/picker";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Download, HelpCircle, Info, Rocket, Sparkles, Wand2 } from "lucide-react";
import { AgentMark } from "@/components/agent-bits";
import { Button, ConfirmDialog, Segmented, Spinner, cx, inputClass } from "@/components/ui";
import { useWorkspace } from "@/components/workspace-context";
import { api, useApi } from "@/lib/client";
import { type Domain, type IntakeAnalysis, type IntakeQuestion } from "@/lib/intake";
import { lineDiff } from "@/lib/optimizer";
import { bestModel } from "@/lib/model-pick";
import { tidyPath } from "@/lib/format";
import { CONCISE_LABELS, type AgentStatus, type BriefResult, type ConciseMode, type InstalledSkill, type PermissionSet, type PresetId, type Recommendation, type SessionRole, type Settings } from "@/lib/types";

/**
 * The Studio flow: idea, a few questions, the optimized prompt, the team, launch.
 * Everything that thinks here is local: the on-device classifier and a light Ollama model.
 */

type Local = {
  ollama: "running" | "not-running" | "not-installed";
  model: string | null;
  pullable: { name: string; size: string }[];
};
type IntakeResp = { analysis: IntakeAnalysis; stack: string[]; local: Local };
type Brief = BriefResult & { polishError?: string };
type Task = {
  key: string;
  role: SessionRole;
  title: string;
  agentId: string;
  brief: string;
  model: string | null;
  afterIndexes: number[];
  shareWorktreeOfIndex: number | null;
  optional: boolean;
  why: string;
};

const WORKFLOWS: { id: PresetId; label: string; body: string }[] = [
  {
    id: "swarm",
    label: "Team build",
    body: "Every ready agent on the job it does best",
  },
  { id: "solo", label: "Solo", body: "One agent does everything" },
  {
    id: "plan-build-review",
    label: "Plan, build, review",
    body: "Three roles in a row",
  },
  { id: "debug-test", label: "Debug and test", body: "Root cause, fix, check" },
  {
    id: "frontend-polish",
    label: "Frontend polish",
    body: "Design-focused build, then review",
  },
];

const READ_ONLY: SessionRole[] = ["plan", "review", "copy"];

const ready = (a: AgentStatus) => a.integration === "supported" && a.install === "installed" && (a.auth === "authenticated" || a.auth === "not-required") && (a.kind !== "local-runtime" || a.models.length > 0);
const edits = (a: AgentStatus) => a.nexusCapabilities.includes("edits-project");
const key = () => Math.random().toString(36).slice(2, 8);

/** One step of the Playground: fills the screen, title on top, the step's action at the bottom. */
function Stage({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <section aria-label={title} className="panel rise-in flex min-h-[calc(100svh-13rem)] flex-col p-5 sm:p-8">
      <h2 className="font-display mb-5 text-[26px] leading-tight text-ink sm:text-[30px]">{title}</h2>
      <div className="flex flex-1 flex-col">{children}</div>
      <div className="mt-6 flex flex-wrap items-center gap-2">{footer}</div>
    </section>
  );
}

type View = "idea" | "questions" | "prompt" | "team" | "approve";
const STEPS: { id: View; label: string }[] = [
  { id: "idea", label: "Idea" },
  { id: "questions", label: "Questions" },
  { id: "prompt", label: "Prompt" },
  { id: "team", label: "Team" },
  { id: "approve", label: "Approve" },
];

/** The four steps as one row: the current one lit, reached ones clickable, the rest waiting. */
function Stepper({ view, reach, done, onGo }: { view: View; reach: Record<View, boolean>; done: Record<View, boolean>; onGo: (v: View) => void }) {
  return (
    <nav aria-label="Playground steps" className="page-sky overflow-hidden rounded-[var(--radius-panel)] border border-white/15 p-2 text-white">
      <ol className="grid grid-cols-5 gap-1">
        {STEPS.map((st, i) => {
          const cur = st.id === view;
          return (
            <li key={st.id}>
              <button
                type="button"
                disabled={!reach[st.id]}
                aria-current={cur ? "step" : undefined}
                onClick={() => onGo(st.id)}
                className={cx(
                  "btn-step flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-left font-mono text-[12px] max-sm:min-h-11 sm:px-3",
                  cur ? "bg-white text-black" : reach[st.id] ? "text-white/80 hover:bg-white/10" : "cursor-not-allowed text-white/30",
                )}
              >
                <span className={cx("grid size-5 shrink-0 place-items-center rounded-[var(--radius-chip)] border text-[11px]", cur ? "border-black/30" : done[st.id] ? "border-ok text-ok" : "border-current")}>
                  {done[st.id] && !cur ? <Check size={11} aria-hidden /> : i + 1}
                </span>
                <span className="truncate">{st.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Toggle({ checked, onChange, label, hint, danger }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; danger?: boolean }) {
  return (
    <label title={hint} className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-line px-4 py-3.5 hover:border-line-strong">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--accent)]" />
      <span className={cx("text-[15px] font-medium", danger && checked ? "text-warn" : "text-ink")}>{label}</span>
    </label>
  );
}

/** One question filling the step: big text, big choices, an own-answer box. */
function QuestionStep({ q, value, onChange, onPicked }: { q: IntakeQuestion; value: string; onChange: (v: string) => void; onPicked: () => void }) {
  const picked = value ? value.split(" + ") : [];
  const custom = picked.filter((p) => !q.options.includes(p)).join(" + ");
  const toggle = (o: string) => {
    if (q.multi) return onChange((picked.includes(o) ? picked.filter((p) => p !== o) : [...picked, o]).join(" + "));
    const next = value === o ? "" : o;
    onChange(next);
    if (next) window.setTimeout(onPicked, 220);
  };
  return (
    <div className="flex flex-col">
      <h2 className="font-display text-[26px] leading-[1.15] text-ink sm:text-[34px]">{q.text}</h2>
      {q.multi && <p className="mt-2 text-[15px] text-ink-2">Pick any that fit.</p>}
      {q.options.length > 0 && (
        <div className="mt-8 grid gap-2.5 sm:grid-cols-2" role="group" aria-label={q.text}>
          {q.options.map((o) => {
            const on = picked.includes(o);
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(o)}
                className={cx(
                  "btn-step flex min-h-14 items-center gap-3 rounded-[var(--radius-control)] border px-4 py-3 text-left text-[16px] transition-colors",
                  on ? "border-ink bg-ink text-canvas" : "border-line text-ink hover:border-line-strong hover:bg-surface-2",
                )}
              >
                <span className={cx("grid size-5 shrink-0 place-items-center border", q.multi ? "rounded-[3px]" : "rounded-full", on ? "border-canvas" : "border-line-strong")}>{on && <Check size={12} aria-hidden />}</span>
                {o}
              </button>
            );
          })}
        </div>
      )}
      <label className="sr-only" htmlFor={`q-${q.id}`}>
        Your own answer to: {q.text}
      </label>
      <input
        id={`q-${q.id}`}
        value={q.options.length ? custom : value}
        onChange={(e) => {
          const own = e.target.value;
          if (!q.options.length) return onChange(own);
          const kept = picked.filter((p) => q.options.includes(p));
          onChange([...(q.multi ? kept : []), ...(own ? [own] : [])].join(" + ") || (q.multi ? "" : (kept[0] ?? "")));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onPicked();
        }}
        placeholder={q.options.length ? "Or type your own" : "Type your answer"}
        className={cx(inputClass, "mt-3 h-14 px-4 text-[16px]")}
      />
    </div>
  );
}

/** Builds tasks for the classic presets (Team build comes from /api/swarm). */
function presetTasks(preset: PresetId, brief: string, editors: AgentStatus[], local: AgentStatus | undefined, defModel: (a: AgentStatus, role: SessionRole) => string | null): Task[] {
  const top = editors[0];
  if (!top) return [];
  const reader = local ?? top;
  const t = (role: SessionRole, title: string, a: AgentStatus, b: string, after: number[], why: string): Task => ({
    key: key(),
    role,
    title,
    agentId: a.id,
    brief: b,
    model: defModel(a, role),
    afterIndexes: after,
    shareWorktreeOfIndex: null,
    optional: false,
    why,
  });
  if (preset === "solo") return [t("solo", "Build it", top, `${brief}\n\nWhen you finish, tell the user exactly how to open and view the result.`, [], `${top.displayName} does the whole task.`)];
  if (preset === "plan-build-review")
    return [
      t("plan", "Plan", reader, `Write an implementation plan for this task. Do not write code.\n\n${brief}`, [], `${reader.displayName} plans, read-only.`),
      t("build", "Build", top, `Implement this task. Follow the plan in the context. When you finish, tell the user how to open and view the result.\n\n${brief}`, [0], `${top.displayName} edits the files.`),
      t("review", "Review", reader, `Review the diff in the context against the task below. List problems by severity with file and line. Do not rewrite the code.\n\n${brief}`, [1], `${reader.displayName} reviews the diff.`),
    ];
  if (preset === "debug-test")
    return [
      t("build", "Debug and fix", top, `Find the root cause before changing code. Add or update a test that fails before the fix and passes after.\n\n${brief}`, [], `${top.displayName} reproduces and fixes.`),
      t("review", "Review the fix", reader, `Review this fix: is the root cause addressed and is it tested?\n\n${brief}`, [0], `${reader.displayName} checks the fix.`),
    ];
  return [
    t("build", "Design and build", top, `Focus on layout, typography, accessibility and responsive behavior. When you finish, tell the user how to open and view the result.\n\n${brief}`, [], `${top.displayName} builds the UI.`),
    t("review", "Design review", reader, `Review the UI changes in the diff for accessibility, responsive layout and consistency.\n\n${brief}`, [0], `${reader.displayName} reviews the design.`),
  ];
}

function LocalModelBanner({ local, onPulled }: { local: Local; onPulled: () => void }) {
  const [ask, setAsk] = useState<{ name: string; size: string } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (local.model) return null;
  const pull = async (name: string) => {
    setErr(null);
    setProgress("Starting download…");
    try {
      const r = await fetch("/api/ollama/pull", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: name, confirm: true }),
      });
      if (!r.ok || !r.body) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `Download failed (${r.status}).`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          const j = JSON.parse(l) as {
            status?: string;
            completed?: number;
            total?: number;
            error?: string;
          };
          if (j.error) throw new Error(j.error);
          setProgress(j.total && j.completed ? `${j.status ?? "Downloading"}: ${Math.round((j.completed / j.total) * 100)}%` : (j.status ?? "Working…"));
        }
      }
      setProgress(null);
      onPulled();
    } catch (e) {
      setProgress(null);
      setErr((e as Error).message);
    }
  };
  return (
    <div className="mb-3 rounded-[var(--radius-control)] border border-warn/30 bg-warn-soft p-3 text-[12.5px] text-ink">
      {local.ollama === "not-installed" && <p>A light local model makes these questions and your prompt smarter, privately. Install Ollama from ollama.com, then come back. Until then Nexus uses its on-device classifier.</p>}
      {local.ollama === "not-running" && <p>Ollama is installed but not running. Open the Ollama app to add a local model. Until then Nexus uses its on-device classifier.</p>}
      {local.ollama === "running" && (
        <div className="flex flex-wrap items-center gap-2">
          <span>No local model is downloaded yet. Add a light one for smarter questions and prompt polishing:</span>
          {local.pullable.map((m) => (
            <Button key={m.name} size="sm" onClick={() => setAsk(m)} disabled={!!progress}>
              <Download size={13} aria-hidden /> {m.name} ({m.size})
            </Button>
          ))}
        </div>
      )}
      {progress && (
        <p className="mt-2 flex items-center gap-2" aria-live="polite">
          <Spinner size={12} /> {progress}
        </p>
      )}
      {err && <p className="mt-2 text-bad">{err}</p>}
      <ConfirmDialog
        open={!!ask}
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          const m = ask!;
          setAsk(null);
          void pull(m.name);
        }}
        title={`Download ${ask?.name}?`}
        body={
          <p>
            Ollama downloads {ask?.name} (about {ask?.size}) from its model registry and keeps it on this computer. Nothing else is installed.
          </p>
        }
        confirmLabel="Download"
      />
    </div>
  );
}

export function PlaygroundView() {
  const router = useRouter();
  const { project, projects, setProjectId, agents, agentsLoading } = useWorkspace();
  const settings = useApi<{ settings: Settings }>("/api/settings");
  const installed = useApi<{
    project: InstalledSkill[];
    global: InstalledSkill[];
  }>(project ? `/api/skills/installed?projectId=${project.id}` : "/api/skills/installed");

  const [goal, setGoal] = useState("");
  const [intake, setIntake] = useState<IntakeResp | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<IntakeQuestion[]>([]);
  const [, setModelQs] = useState<"idle" | "loading" | "done" | "failed">("idle");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  // Which step is on screen. One step at a time; the stepper moves between the ones already reached.
  const [view, setView] = useState<View>("idea");
  const [analyzedGoal, setAnalyzedGoal] = useState("");
  const [qPage, setQPage] = useState(0);

  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefText, setBriefText] = useState("");
  const [edited, setEdited] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  const [preset, setPreset] = useState<PresetId>("swarm");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [teamNotes, setTeamNotes] = useState<string[]>([]);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [picks, setPicks] = useState<{ state: "idle" | "loading" | "done"; picks: { name: string; why: string }[]; engine?: string; installed?: number; error?: string }>({ state: "idle", picks: [] });
  const [skills, setSkills] = useState<string[]>([]);
  const [concise, setConcise] = useState<ConciseMode>("normal");
  const [perm, setPerm] = useState<PermissionSet>({
    editFiles: true,
    runShell: false,
    network: false,
    isolate: true,
  });
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    const s = settings.data?.settings;
    if (!s) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConcise(s.defaultConcise);
    setPerm(s.defaultPermissions);
  }, [settings.data]);

  const launchable = agents.filter(ready);
  const editors = launchable.filter(edits);
  const local = launchable.find((a) => a.kind === "local-runtime");
  const answeredDecisions = useMemo(() => questions.filter((q) => answers[q.id]?.trim()).map((q) => ({ q: q.text, a: answers[q.id] })), [questions, answers]);
  const domain: Domain = intake?.analysis.domain ?? "webapp";

  const projectId = project?.id ?? null;
  const analyze = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        setIntakeError("Describe what you want built first.");
        return;
      }
      setIntakeError(null);
      setAnalyzing(true);
      setStage(1);
      setBrief(null);
      setEdited(false);
      setTasks([]);
      setAnswers({});
      try {
        const r = await api<IntakeResp>("/api/intake", {
          body: { goal: text, projectId },
        });
        setIntake(r);
        setQuestions(r.analysis.questions);
        setStage(2);
        setAnalyzedGoal(text.trim());
        setQPage(0);
        setView("questions");
        if (r.local.model) {
          setModelQs("loading");
          api<{ questions: IntakeQuestion[]; error?: string }>("/api/intake/questions", {
            body: {
              goal: text,
              existing: r.analysis.questions.map((q) => ({ text: q.text })),
            },
          })
            .then((m) => {
              setQuestions((cur) => [...cur, ...m.questions.filter((x) => !cur.some((c) => c.id === x.id))]);
              setModelQs(m.error ? "failed" : "done");
            })
            .catch(() => setModelQs("failed"));
        } else setModelQs("idle");
      } catch (e) {
        setIntakeError((e as Error).message);
      } finally {
        setAnalyzing(false);
      }
    },
    [projectId],
  );

  // Arriving from Home with a goal starts the flow right away. Next.js keeps this page mounted
  // (hidden with <Activity>) between visits, so this runs on every reveal, not only on first mount;
  // removing the keys makes it run once per handoff.
  useEffect(() => {
    const consume = () => {
      try {
        const g = window.sessionStorage.getItem("nexus.goal");
        const p = window.sessionStorage.getItem("nexus.preset") as PresetId | null;
        const fresh = window.sessionStorage.getItem("nexus.new");
        window.sessionStorage.removeItem("nexus.goal");
        window.sessionStorage.removeItem("nexus.preset");
        window.sessionStorage.removeItem("nexus.new");
        if (g) {
           
          setPreset(p ?? "swarm");
          setGoal(g);
          void analyze(g);
        } else if (fresh) {
          setGoal("");
          setIntake(null);
          setQuestions([]);
          setAnswers({});
          setBrief(null);
          setBriefText("");
          setEdited(false);
          setTasks([]);
          setStage(1);
          setView("idea");
          setAnalyzedGoal("");
          setPreset("swarm");
          setLaunchError(null);
          window.setTimeout(() => document.getElementById("pg-goal")?.focus(), 50);
        }
      } catch {}
    };
    consume();
    window.addEventListener("nexus:new-task", consume);
    return () => window.removeEventListener("nexus:new-task", consume);
  }, [analyze]);

  // The optimized prompt follows the answers instantly (template engine), until the user edits it.
  useEffect(() => {
    if (!intake || edited) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      api<Brief>("/api/intake/brief", {
        body: {
          goal,
          projectId: project?.id ?? null,
          decisions: answeredDecisions,
        },
        signal: ctrl.signal,
      })
        .then((b) => {
          setBrief(b);
          setBriefText(b.brief);
        })
        .catch(() => {});
    }, 200);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intake, answeredDecisions, edited, project?.id]);

  const polish = async () => {
    if (!intake?.local.model) return;
    setPolishing(true);
    try {
      const b = await api<Brief>("/api/intake/brief", {
        body: {
          goal,
          projectId: project?.id ?? null,
          decisions: answeredDecisions,
          polish: true,
          base: briefText,
        },
      });
      setBrief(b);
      if (!b.polishError) {
        setBriefText(b.brief);
        setEdited(true); // keep the polished text; answers no longer overwrite it
      }
    } catch {
      setBrief((cur) => (cur ? { ...cur, polishError: "Polishing failed." } : cur));
    } finally {
      setPolishing(false);
    }
  };

  const toTeam = () => {
    setStage(3);
    setView("prompt");
    if (intake?.local.model && !edited) void polish();
  };

  // Team plan.
  const defModel = useCallback((a: AgentStatus, role: SessionRole = "build") => bestModel(a, role, { claudeModel: settings.data?.settings.claudeModel, codexModel: settings.data?.settings.codexModel }), [settings.data]);
  useEffect(() => {
    if (stage !== 3 || !briefText) return;
    const ctrl = new AbortController();
    if (preset === "swarm") {
      api<{ steps: Omit<Task, "key">[]; notes: string[] }>("/api/swarm", {
        body: { goal, brief: briefText, domain, answers },
        signal: ctrl.signal,
      })
        .then((r) => {
          setTasks(r.steps.map((s) => ({ ...s, key: key() })));
          setTeamNotes(r.notes);
        })
        .catch(() => {});
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTasks(presetTasks(preset, briefText, editors, local, defModel));
      setTeamNotes(editors.length ? [] : ["No installed, signed-in agent can edit files. Set one up in Agents."]);
    }
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, preset, briefText, agents]);

  // Skills that fit, from the recommender.
  useEffect(() => {
    if (stage !== 3 || !brief) return;
    const ctrl = new AbortController();
    api<Recommendation>("/api/recommend", {
      body: {
        goal,
        taskType: brief.taskType,
        preference: settings.data?.settings.defaultPreference ?? "quality",
        projectId: project?.id ?? null,
      },
      signal: ctrl.signal,
    })
      .then((r) => {
        setRec(r);
        setSkills((cur) => (cur.length ? cur : r.skills.filter((s) => s.installed).map((s) => s.id.split("@")[1])));
      })
      .catch(() => {});
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, brief?.taskType, project?.id]);

  // The light local model picks installed skills that fit (keyword ranking first, so it only chooses among close matches).
  useEffect(() => {
    if (stage !== 3 || !goal.trim()) return;
    const ctrl = new AbortController();
    const task = [goal, ...answeredDecisions.map((d) => `${d.q} ${d.a}`)].join("\n");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPicks({ state: "loading", picks: [] });
    api<{ picks: { name: string; why: string }[]; engine: string; installed: number; error?: string }>("/api/skills/pick", { body: { task, projectId: project?.id ?? null }, signal: ctrl.signal })
      .then((r) => {
        setPicks({ state: "done", picks: r.picks, engine: r.engine, installed: r.installed, error: r.error });
        setSkills((cur) => Array.from(new Set([...cur, ...r.picks.map((x) => x.name)])));
      })
      .catch(() => setPicks({ state: "done", picks: [], error: "Skill picking failed." }));
    return () => ctrl.abort();
     
  }, [stage, goal, answeredDecisions, project?.id]);

  // Exact commands, for approval.
  useEffect(() => {
    if (!tasks.length) return;
    const ctrl = new AbortController();
    Promise.all(
      tasks.map(async (t) => {
        const p = READ_ONLY.includes(t.role) ? { ...perm, editFiles: false, isolate: false } : perm;
        try {
          const r = await api<{ text: string }>("/api/preview", {
            body: {
              agentId: t.agentId,
              brief: t.brief,
              model: t.model,
              concise,
              skills,
              permissions: p,
            },
            signal: ctrl.signal,
          });
          return [t.key, r.text] as const;
        } catch {
          return [t.key, "Preview unavailable"] as const;
        }
      }),
    ).then((rows) => setPreviews(Object.fromEntries(rows)));
    return () => ctrl.abort();
  }, [tasks, perm, concise, skills]);

  const launch = async () => {
    if (!project) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const r = await api<{ workflow: { id: string } }>("/api/workflows", {
        body: {
          projectId: project.id,
          preset,
          goal,
          brief: briefText,
          skills,
          concise,
          permissions: perm,
          tasks: tasks.map((t) => ({
            role: t.role,
            agentId: t.agentId,
            title: t.title,
            brief: t.brief,
            model: t.model || null,
            afterIndexes: t.afterIndexes,
            shareWorktreeOfIndex: t.shareWorktreeOfIndex,
            optional: t.optional,
          })),
        },
      });
      router.push(`/runs/${r.workflow.id}`);
    } catch (e) {
      setLaunchError((e as Error).message);
      setLaunching(false);
    }
  };

  const installedNames = useMemo(() => new Set([...(installed.data?.project ?? []), ...(installed.data?.global ?? [])].map((s) => s.name.toLowerCase())), [installed.data]);
  const diffRows = brief && showDiff ? lineDiff(goal.trim(), briefText) : [];
  const answeredCount = answeredDecisions.length;

  return (
    <div className="flex w-full flex-col gap-4">
      <Stepper
        view={view}
        reach={{ idea: true, questions: !!intake, prompt: stage === 3 && !!brief, team: stage === 3 && !!brief, approve: stage === 3 && !!brief && tasks.length > 0 }}
        done={{ idea: !!intake, questions: stage === 3, prompt: stage === 3 && !!brief && (view === "team" || view === "approve"), team: view === "approve", approve: false }}
        onGo={setView}
      />
      {view === "idea" && (
        <Stage
          title="What do you want built?"
          footer={
            <>
              {projects.length ? (
                <div className="w-full max-w-sm">
                  <Picker label="Project folder" size="lg" value={project?.id ?? ""} onChange={setProjectId} options={projects.map((p) => ({ value: p.id, label: p.name, hint: tidyPath(p.path) }))} />
                </div>
              ) : (
                <Link href="/projects" className="flex h-11 items-center rounded-[var(--radius-control)] border border-dashed border-line-strong px-4 text-[14px] text-accent">
                  Add a project folder first
                </Link>
              )}
              <span className="ml-auto" />
              {intake && goal.trim() === analyzedGoal ? (
                <Button size="lg" variant="primary" onClick={() => setView(stage === 3 ? "prompt" : "questions")}>
                  {stage === 3 ? "Back to the prompt" : "Back to the questions"} <ArrowRight size={16} aria-hidden />
                </Button>
              ) : (
                <Button size="lg" variant="primary" onClick={() => analyze(goal)} disabled={analyzing || !goal.trim()}>
                  {analyzing ? <Spinner /> : <Sparkles size={16} aria-hidden />} {intake ? "Ask questions for the new idea" : "Continue to questions"}
                </Button>
              )}
            </>
          }
        >
          <label htmlFor="pg-goal" className="sr-only">
            What do you want built?
          </label>
          <textarea
            id="pg-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void analyze(goal);
            }}
            placeholder="A website to track my sleep, with a weekly chart and a bedtime goal."
            className={cx(inputClass, "min-h-48 flex-1 resize-none p-5 text-[20px] leading-relaxed")}
            aria-invalid={!!intakeError}
          />
          {intakeError && (
            <p role="alert" className="mt-3 text-[15px] text-bad">
              {intakeError}
            </p>
          )}
        </Stage>
      )}

      {intake && view === "questions" && (
        <section aria-label="Questions" className="panel rise-in flex min-h-[calc(100svh-13rem)] flex-col p-5 sm:p-10">
          <LocalModelBanner local={intake.local} onPulled={() => analyze(goal)} />
          {questions.length > 0 && (
            <div className="mb-10 flex items-center gap-3" aria-label={`Question ${Math.min(qPage, questions.length - 1) + 1} of ${questions.length}`}>
              <ol className="flex flex-1 gap-1" aria-hidden>
                {questions.map((q, i) => (
                  <li key={q.id} className="flex-1">
                    <button type="button" tabIndex={-1} onClick={() => setQPage(i)} className={cx("block h-1 w-full rounded-full", i === Math.min(qPage, questions.length - 1) ? "bg-ink" : answers[q.id]?.trim() ? "bg-ink-3" : "bg-line")} />
                  </li>
                ))}
              </ol>
              <span className="font-mono text-[13px] text-ink-2 tabular">
                {Math.min(qPage, questions.length - 1) + 1} / {questions.length}
              </span>
            </div>
          )}
          <div className="flex flex-1 flex-col justify-center">
            {questions.length ? (
              (() => {
                const i = Math.min(qPage, questions.length - 1);
                const q = questions[i];
                const last = i === questions.length - 1;
                return <QuestionStep key={q.id} q={q} value={answers[q.id] ?? ""} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} onPicked={() => (last ? undefined : setQPage(i + 1))} />;
              })()
            ) : (
              <h2 className="font-display text-[26px] leading-[1.15] text-ink sm:text-[34px]">Your idea already covers the basics.</h2>
            )}
          </div>
          {(() => {
            const i = Math.min(qPage, Math.max(0, questions.length - 1));
            const last = i >= questions.length - 1;
            const finish = stage === 3 ? () => setView("prompt") : toTeam;
            return (
              <div className="mt-10 flex flex-wrap items-center gap-2">
                {i > 0 && (
                  <Button size="lg" onClick={() => setQPage(i - 1)}>
                    <ArrowLeft size={16} aria-hidden /> Back
                  </Button>
                )}
                {last ? (
                  <Button size="lg" variant="primary" onClick={finish}>
                    {stage === 3 ? "Back to the prompt" : "Build my prompt"} <ArrowRight size={16} aria-hidden />
                  </Button>
                ) : (
                  <Button size="lg" variant="primary" onClick={() => setQPage(i + 1)}>
                    {answers[questions[i]?.id]?.trim() ? "Next" : "Skip this one"} <ArrowRight size={16} aria-hidden />
                  </Button>
                )}
                {!last && (
                  <Button size="lg" variant="ghost" className="ml-auto" onClick={finish}>
                    {stage === 3 ? "Back to the prompt" : answeredCount ? "Build my prompt now" : "Skip all questions"}
                  </Button>
                )}
              </div>
            );
          })()}
        </section>
      )}

      {intake && view === "prompt" && brief && (
        <Stage
          title="The prompt your agents get"
          footer={
            <>
              <Button size="lg" variant="ghost" onClick={() => setShowDiff((v) => !v)} aria-pressed={showDiff}>
                {showDiff ? "Edit the prompt" : "What changed"}
              </Button>
              {intake.local.model && brief.engine.kind !== "local-model" && (
                <Button size="lg" variant="ghost" onClick={polish} disabled={polishing}>
                  {polishing ? <Spinner /> : <Wand2 size={15} aria-hidden />} {polishing ? "Adding scope" : "Suggest scope"}
                </Button>
              )}
              {edited && (
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => {
                    setEdited(false);
                    setBrief((b) => (b ? { ...b, engine: { kind: "template" } } : b));
                  }}
                >
                  Rebuild from answers
                </Button>
              )}
              <Button size="lg" variant="primary" className="ml-auto" onClick={() => setView("team")}>
                Pick the team <ArrowRight size={16} aria-hidden />
              </Button>
            </>
          }
        >
          {brief.polishError && <p className="mb-3 text-[15px] text-warn">Kept the template prompt: {brief.polishError}</p>}
          {showDiff ? (
            <div className="grid flex-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
              <pre className="term overflow-auto rounded-[var(--radius-control)] border border-line p-4 text-[13px]" aria-label="Line diff between your idea and the prompt">
                {diffRows.map((r, i) => (
                  <div key={i} className={cx("whitespace-pre-wrap", r.type === "add" && "diff-add", r.type === "del" && "diff-del", r.type === "same" && "text-ink-3")}>
                    {r.type === "add" ? "+ " : r.type === "del" ? "- " : "  "}
                    {r.text || " "}
                  </div>
                ))}
              </pre>
              <ul className="flex flex-col gap-2 text-[15px] text-ink-2">
                {brief.changes.map((c) => (
                  <li key={c} className="flex gap-2">
                    <Check size={16} className="mt-1 shrink-0 text-ok" aria-hidden /> {c}
                  </li>
                ))}
                {brief.assumptions.map((c) => (
                  <li key={c} className="flex gap-2">
                    <HelpCircle size={16} className="mt-1 shrink-0 text-warn" aria-hidden /> {c}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <label htmlFor="pg-brief" className="sr-only">
                Prompt the agents receive
              </label>
              <textarea
                id="pg-brief"
                value={briefText}
                onChange={(e) => {
                  setBriefText(e.target.value);
                  setEdited(true);
                }}
                className={cx(inputClass, "min-h-72 flex-1 resize-none p-5 font-mono text-[14px] leading-relaxed")}
              />
            </>
          )}
        </Stage>
      )}

      {stage === 3 && view === "team" && (
        <Stage
          title="Your team"
          footer={
            <Button size="lg" variant="primary" className="ml-auto" onClick={() => setView("approve")} disabled={!tasks.length}>
              Review and approve <ArrowRight size={16} aria-hidden />
            </Button>
          }
        >
          <div className="mb-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Workflow">
            {WORKFLOWS.map((w) => (
              <button
                key={w.id}
                type="button"
                role="radio"
                aria-checked={preset === w.id}
                onClick={() => setPreset(w.id)}
                title={w.body}
                className={cx("btn-step rounded-[var(--radius-control)] border px-4 py-2.5 text-[15px] font-medium", preset === w.id ? "border-ink bg-ink text-canvas" : "border-line text-ink-2 hover:border-line-strong hover:text-ink")}
              >
                {w.label}
              </button>
            ))}
          </div>
          {teamNotes.length > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-[var(--radius-control)] border border-warn/30 bg-warn-soft px-4 py-3 text-[15px] text-ink">
              <Info size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <span>{teamNotes.join(" ")}</span>
            </div>
          )}
          {agentsLoading && !tasks.length && (
            <p className="flex items-center gap-2 text-[15px] text-ink-2">
              <Spinner size={14} /> Checking which agents are ready
            </p>
          )}
          <ol className="grid flex-1 auto-rows-fr divide-y divide-line rounded-[var(--radius-control)] border border-line" aria-label="Jobs">
            {tasks.map((t) => {
              const a = agents.find((x) => x.id === t.agentId);
              const choices = t.role === "assets" ? launchable.filter((x) => x.nexusCapabilities.includes("images")) : READ_ONLY.includes(t.role) ? launchable : editors;
              const tip = `${t.why} ${t.afterIndexes.length ? `Starts after ${t.afterIndexes.map((x) => tasks[x]?.title).join(" and ")}` : "Starts right away"}${READ_ONLY.includes(t.role) ? ", read-only" : ""}.${t.optional ? " If it fails, the build goes on without it." : ""}${previews[t.key] ? `\n\nCommand: ${previews[t.key]}` : ""}`;
              return (
                <li key={t.key} title={tip} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  {a && <AgentMark agent={a} size="lg" />}
                  <span className="min-w-0 flex-1 basis-40 text-[18px] font-semibold text-ink">{t.title}</span>
                  <div className="w-44">
                    <Picker
                      label={`Agent for ${t.title}`}
                      size="lg"
                      disabled={choices.length < 2}
                      value={t.agentId}
                      onChange={(v) => {
                        const na = agents.find((x) => x.id === v);
                        setTasks((ts) => ts.map((x) => (x.key === t.key ? { ...x, agentId: v, model: na ? defModel(na, t.role) : null, why: `You picked ${na?.displayName}.` } : x)));
                      }}
                      options={(choices.length ? choices : a ? [a] : []).map((c) => ({ value: c.id, label: c.displayName }))}
                    />
                  </div>
                  {a && a.models.length > 0 && (
                    <div className="w-52">
                      <Picker
                        label={`Model for ${t.title}`}
                        size="lg"
                        className={a.kind === "local-runtime" ? "font-mono" : undefined}
                        value={t.model ?? ""}
                        onChange={(v) => setTasks((ts) => ts.map((x) => (x.key === t.key ? { ...x, model: v || null } : x)))}
                        options={[
                          ...(a.kind !== "local-runtime" ? [{ value: "", label: `${a.displayName.split(" ")[0]} default` }] : []),
                          ...a.models.map((m) => {
                            const info = a.modelInfo?.find((x) => x.id === m);
                            return { value: m, label: info ? info.label : a.kind === "local-runtime" ? m : m[0].toUpperCase() + m.slice(1), hint: info?.description?.slice(0, 60) };
                          }),
                        ]}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Stage>
      )}

      {stage === 3 && view === "approve" && (
        <Stage
          title="Approve and start"
          footer={
            <>
              {launchError && (
                <p role="alert" className="basis-full rounded bg-bad-soft px-4 py-3 text-[15px] text-bad">
                  {launchError}
                </p>
              )}
              <Button variant="primary" size="lg" className="ml-auto" disabled={launching || !project || !tasks.length} onClick={launch}>
                {launching ? <Spinner /> : <Rocket size={16} aria-hidden />} Approve and start building
              </Button>
            </>
          }
        >
          <div className="grid flex-1 gap-3 lg:grid-cols-2">
            <section aria-label="Team" className="flex flex-col rounded-[var(--radius-control)] border border-line">
              <h3 className="border-b border-line px-5 py-3 text-[16px] font-semibold text-ink">Team</h3>
              <ol className="flex flex-1 flex-col divide-y divide-line">
                {tasks.map((t) => {
                  const a = agents.find((x) => x.id === t.agentId);
                  return (
                    <li key={t.key} className="flex flex-1 items-center gap-3 px-5 py-3 text-[15px]">
                      {a && <AgentMark agent={a} size="md" />}
                      <span className="flex-1 text-ink">{t.title}</span>
                      <span className="font-mono text-[13px] text-ink-2">
                        {a?.displayName ?? t.agentId}
                        {t.model ? `, ${t.model}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section aria-label="Skills" className="flex flex-col rounded-[var(--radius-control)] border border-line">
              <h3 className="border-b border-line px-5 py-3 text-[16px] font-semibold text-ink">Skills</h3>
              <div className="flex flex-1 flex-col gap-3 p-5">
                {picks.state === "loading" ? (
                  <p className="flex items-center gap-2 text-[15px] text-ink-2">
                    <Spinner size={14} /> Picking skills
                  </p>
                ) : picks.picks.length || (rec?.skills.length ?? 0) ? (
                  <ul className="flex flex-wrap gap-2">
                    {picks.picks.map((x) => (
                      <li key={x.name}>
                        <label title={x.why} className={cx("inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-chip)] border px-3 py-2 text-[14px]", skills.includes(x.name) ? "border-ink text-ink" : "border-line text-ink-2")}>
                          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={skills.includes(x.name)} onChange={(e) => setSkills((cur) => (e.target.checked ? [...cur, x.name] : cur.filter((y) => y !== x.name)))} />
                          <span className="font-mono">{x.name}</span>
                        </label>
                      </li>
                    ))}
                    {rec?.skills
                      .filter((s) => !picks.picks.some((x) => x.name === s.id.split("@")[1]))
                      .map((s) => {
                        const n = s.id.split("@")[1];
                        const can = s.installed || installedNames.has(n.toLowerCase());
                        return (
                          <li key={s.id}>
                            {can ? (
                              <label title={s.why} className={cx("inline-flex cursor-pointer items-center gap-2 rounded-[var(--radius-chip)] border px-3 py-2 text-[14px]", skills.includes(n) ? "border-ink text-ink" : "border-line text-ink-2")}>
                                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={skills.includes(n)} onChange={(e) => setSkills((cur) => (e.target.checked ? [...cur, n] : cur.filter((x) => x !== n)))} />
                                <span className="font-mono">{n}</span>
                              </label>
                            ) : (
                              <Link href={`/skills?inspect=${encodeURIComponent(s.id)}`} title={s.why} className="inline-flex items-center gap-1 rounded-[var(--radius-chip)] border border-dashed border-line px-3 py-2 font-mono text-[14px] text-ink-2 hover:text-ink">
                                <Download size={14} aria-hidden /> {n}
                              </Link>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                ) : (
                  <p className="text-[15px] text-ink-2">None of your {picks.installed ?? 0} installed skills fit this task.</p>
                )}
              </div>
            </section>

            <section aria-label="Permissions" className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-line p-5 lg:col-span-2">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <Toggle checked={perm.editFiles} onChange={(v) => setPerm({ ...perm, editFiles: v })} label="Edit project files" hint="Off runs agents read-only." />
                <Toggle checked={perm.isolate} onChange={(v) => setPerm({ ...perm, isolate: v })} label="Own git worktree" hint="Changes stay on a nexus/ branch until you apply them." />
                <Toggle checked={perm.runShell} onChange={(v) => setPerm({ ...perm, runShell: v })} danger label="Shell commands" hint="Lets Claude Code run tests and installs. Codex always uses its own sandbox." />
                <Toggle checked={perm.network} onChange={(v) => setPerm({ ...perm, network: v })} danger label="Web access" hint="Off blocks web tools and sandbox network." />
              </div>
              <Segmented<ConciseMode> label="Output style" value={concise} onChange={setConcise} options={(Object.keys(CONCISE_LABELS) as ConciseMode[]).map((c) => ({ value: c, label: CONCISE_LABELS[c] }))} />
            </section>
          </div>
        </Stage>
      )}
    </div>
  );
}
