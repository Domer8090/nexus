"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, ArrowRightLeft, Bookmark, Check, CircleStop, Copy, Info, FileCode2, FlaskConical, GitMerge, MessageSquareReply, RotateCw, SquareTerminal, Trash2 } from "lucide-react";
import { AgentMark, SessionBadge } from "@/components/agent-bits";
import { Button, ConfirmDialog, Dialog, Drawer, Segmented, Spinner, Toast, cx, inputClass } from "@/components/ui";
import { useWorkspace } from "@/components/workspace-context";
import { api, fmtNum, useApi } from "@/lib/client";
import { tidyPath } from "@/lib/format";
import { classifyFailure } from "@/lib/failure";
import { CONCISE_LABELS, type AgentEvent, type AgentStatus, type Session, type Workflow } from "@/lib/types";

type WorkflowResp = { workflow: Workflow; sessions: Session[]; overlaps: { file: string; sessions: string[] }[] };
type DiffResp = { files: { path: string; status: string; additions: number; deletions: number; binary: boolean }[]; patch: string; truncated?: boolean; note?: string; isolated?: boolean; branch?: string | null; base?: string | null };

const ROLE: Record<Session["role"], string> = { solo: "Solo", plan: "Plan", build: "Build", review: "Review", parallel: "Parallel", revise: "Revision", copy: "Copy", assets: "Images" };
const active = (s: Session) => s.status === "running" || s.status === "starting" || s.status === "queued";

function useSessionStream(id: string) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const last = useRef(0);
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    const open = () => {
      es = new EventSource(`/api/sessions/${id}/events?after=${last.current}`);
      es.addEventListener("agent", (m) => {
        const e = JSON.parse((m as MessageEvent).data) as AgentEvent;
        if (e.id <= last.current) return;
        last.current = e.id;
        setEvents((cur) => [...cur, e]);
      });
      es.addEventListener("session", (m) => setSession(JSON.parse((m as MessageEvent).data)));
      es.onerror = () => {
        es?.close();
        if (!closed) window.setTimeout(open, 2000);
      };
    };
    open();
    return () => {
      closed = true;
      es?.close();
    };
  }, [id]);
  return { events, session };
}

export function DiffView({ diff }: { diff: DiffResp }) {
  const [file, setFile] = useState<string | null>(null);
  const chunks = useMemo(() => {
    const out: { path: string; lines: string[] }[] = [];
    for (const line of diff.patch.split("\n")) {
      if (line.startsWith("diff --git ")) out.push({ path: line.split(" b/").pop() ?? line, lines: [] });
      out.at(-1)?.lines.push(line);
    }
    return out;
  }, [diff.patch]);
  if (diff.note) return <p className="text-[13px] text-ink-2">{diff.note}</p>;
  if (!diff.files.length) return <p className="text-[13px] text-ink-2">No file changes.</p>;
  const shown = file ? chunks.filter((c) => c.path === file) : chunks;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-0.5 text-[12.5px]">
        {diff.files.map((f) => (
          <li key={f.path}>
            <button type="button" onClick={() => setFile(file === f.path ? null : f.path)} className={cx("flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono hover:bg-surface-2", file === f.path && "bg-surface-2")}>
              <span className={cx("w-14 shrink-0 text-[11px]", f.status === "added" ? "text-ok" : f.status === "deleted" ? "text-bad" : "text-warn")}>{f.status}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{f.path}</span>
              <span className="text-ok">+{f.additions}</span>
              <span className="text-bad">-{f.deletions}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="term overflow-x-auto rounded-[var(--radius-control)] border border-line">
        {shown.map((c) => (
          <pre key={c.path} className="min-w-max border-b border-line px-3 py-2 last:border-0">
            {c.lines.map((l, i) => (
              <div key={i} className={cx(l.startsWith("+") && !l.startsWith("+++") && "diff-add", l.startsWith("-") && !l.startsWith("---") && "diff-del", l.startsWith("@@") && "diff-hunk", (l.startsWith("diff ") || l.startsWith("index ")) && "text-ink-3")}>
                {l || " "}
              </div>
            ))}
          </pre>
        ))}
      </div>
      {diff.truncated && <p className="text-[12px] text-warn">The diff is large and was cut off. Open the worktree to see everything.</p>}
    </div>
  );
}

const SIGN_IN_CMD: Record<string, string> = { "claude-code": "claude auth login", codex: "codex login" };

/** Says what went wrong in plain words and offers the fixes that apply. */
function FailureHelp({ s, agent, agents, busy, onMove, onRetry, notify }: { s: Session; agent?: AgentStatus; agents: AgentStatus[]; busy: boolean; onMove: (agentId: string) => void; onRetry: () => void; notify: (m: string) => void }) {
  const kind = classifyFailure(s.error);
  const skipped = s.status === "cancelled" && s.error?.startsWith("Skipped because");
  const name = agent?.displayName ?? s.agentId;
  const ok = (a: AgentStatus) => a.install === "installed" && (a.auth === "authenticated" || a.auth === "not-required") && (a.kind !== "local-runtime" || a.models.length > 0);
  const fits = (a: AgentStatus) => (s.role === "assets" ? a.nexusCapabilities.includes("images") : s.permissions.editFiles ? a.nexusCapabilities.includes("edits-project") : a.nexusCapabilities.includes("headless"));
  const others = agents.filter((a) => a.id !== s.agentId && ok(a) && fits(a));
  const [pick, setPick] = useState("");
  const target = pick || others[0]?.id || "";
  const cmd = agent?.loginCommand?.command ?? SIGN_IN_CMD[s.agentId];
  const title = skipped
    ? "Waiting on an earlier step"
    : kind === "sign-in"
      ? `${name} needs you to sign in again`
      : kind === "limit"
        ? `${name} hit a usage limit`
        : kind === "missing"
          ? `${name} is not available`
          : kind === "network"
            ? "The network dropped"
          : s.status === "cancelled"
            ? "Stopped"
            : "This step failed";
  const fix = skipped
    ? "It runs again by itself when you retry or move the earlier step."
    : kind === "sign-in"
      ? `Run the sign-in command in Terminal, then press Retry. Or move this step to another signed-in agent now.`
      : kind === "limit"
        ? "Wait for the limit to reset and press Retry, or move this step to another agent now."
        : kind === "network"
          ? "Nexus runs this step again by itself when the connection is back. Set a backup Wi-Fi in Settings to switch to your hotspot automatically."
        : "Read the log for details, then retry or move this step to another agent.";
  return (
    <div role={skipped ? "status" : "alert"} className={cx("border-b border-line px-3 py-2.5 text-[12.5px] text-ink", skipped ? "bg-surface-2/60" : "bg-bad-soft")}>
      <p className="font-semibold">{title}</p>
      <p className="mt-0.5 text-ink-2">{fix}</p>
      {!skipped && kind === "sign-in" && cmd && (
        <div className="mt-2 flex items-center gap-1.5">
          <code className="term rounded border border-line px-2 py-1 font-mono text-[12px]">{cmd}</code>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Copy sign-in command"
            onClick={() => {
              void navigator.clipboard?.writeText(cmd).then(() => notify("Copied. Paste it in Terminal."));
            }}
          >
            <Copy size={13} aria-hidden />
          </Button>
          <Link href="/agents" className="text-[12px] text-accent underline underline-offset-2">
            Agents
          </Link>
        </div>
      )}
      {!skipped && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={onRetry} disabled={busy}>
            <RotateCw size={14} aria-hidden /> Retry with {name}
          </Button>
          {others.length > 0 && (
            <>
              {others.length > 1 && (
                <select aria-label="Agent to move this step to" value={target} onChange={(e) => setPick(e.target.value)} className={cx(inputClass, "h-8 w-auto py-0 text-[12.5px]")}>
                  {others.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.displayName}
                    </option>
                  ))}
                </select>
              )}
              <Button size="sm" variant="primary" onClick={() => onMove(target)} disabled={busy || !target}>
                <ArrowRightLeft size={14} aria-hidden /> Run with {others.find((a) => a.id === target)?.displayName}
              </Button>
            </>
          )}
        </div>
      )}
      <details className="mt-2 text-[11.5px] text-ink-3">
        <summary className="cursor-pointer">Message from {name}</summary>
        <p className="mt-1 font-mono whitespace-pre-wrap">{s.error}</p>
      </details>
    </div>
  );
}

function SessionLane({ s0, scripts, projectName, onChanged, notify }: { s0: Session; scripts: string[]; projectName: string; onChanged: () => void; notify: (m: string) => void }) {
  const { events, session } = useSessionStream(s0.id);
  const s = session ?? s0;
  const { agents } = useWorkspace();
  const agent = agents.find((a) => a.id === s.agentId);
  const [view, setView] = useState<"output" | "activity">("output");
  const [diffOpen, setDiffOpen] = useState(false);
  const [diff, setDiff] = useState<DiffResp | null>(null);
  const [termOpen, setTermOpen] = useState(false);
  const [confirm, setConfirm] = useState<"apply" | "discard" | null>(null);
  const [revise, setRevise] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [check, setCheck] = useState<string | null>(null);
  const [checkResult, setCheckResult] = useState<{ ok: boolean; output: string; command: string; durationMs: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const outRef = useRef<HTMLDivElement>(null);

  const text = events.filter((e) => e.kind === "text").map((e) => e.text).join("");
  const files = Array.from(new Set(events.filter((e) => e.kind === "file").map((e) => e.text)));
  const lastStatus = [...events].reverse().find((e) => e.kind === "status" || e.kind === "tool")?.text;

  useEffect(() => {
    const el = outRef.current;
    if (el && active(s) && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [events.length, s]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      await api(`/api/sessions/${s.id}/action`, { body: { action, ...extra } });
      onChanged();
      return true;
    } catch (e) {
      notify((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const openDiff = async () => {
    setDiffOpen(true);
    setDiff(null);
    try {
      setDiff(await api<DiffResp>(`/api/sessions/${s.id}/diff`));
    } catch (e) {
      setDiff({ files: [], patch: "", note: (e as Error).message });
    }
  };

  const canReview = s.permissions.editFiles && !active(s) && s.status !== "discarded";
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <article id={`lane-${s.id}`} className="panel flex min-w-0 scroll-mt-20 flex-col" aria-labelledby={`lane-title-${s.id}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        {agent && <AgentMark agent={agent} size="sm" />}
        <div className="min-w-0 flex-1" title={`${agent?.displayName ?? s.agentId}${s.model ? `, ${s.model}` : ""}, ${ROLE[s.role]}${s.worktreeBranch ? `, ${s.worktreeBranch}` : s.permissions.editFiles ? ", edits folder directly" : ", read-only"}`}>
          <h3 id={`lane-title-${s.id}`} className="truncate text-[16px] font-semibold">
            {s.title}: {agent?.displayName ?? s.agentId}
          </h3>
        </div>
        <span aria-live="polite">
          <SessionBadge status={s.status} readOnly={!s.permissions.editFiles} />
        </span>
      </header>

      {active(s) && lastStatus && (
        <p className="truncate border-b border-line bg-surface-2/50 px-3 py-1.5 font-mono text-[11.5px] text-ink-2" aria-live="polite">
          {tidyPath(lastStatus.replace(s.cwd + "/", ""))}
        </p>
      )}
      {s.notice && !s.error && (
        <p className="flex gap-2 border-b border-line bg-accent-soft px-3 py-2 text-[12.5px] text-ink" aria-live="polite">
          <Info size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          {s.notice}
        </p>
      )}
      {s.error && <FailureHelp s={s} agent={agent} agents={agents} busy={!!busy} onMove={(agentId) => act("reassign", { agentId })} onRetry={() => act("retry")} notify={notify} />}

      <div className="flex items-center gap-2 px-3 pt-2">
        <Segmented
          size="sm"
          label="Lane view"
          value={view}
          onChange={setView}
          options={[
            { value: "output", label: "Output" },
            { value: "activity", label: `Activity (${events.length})` },
          ]}
        />
        {s.status === "queued" && s.dependsOn && <span className="text-[12px] text-ink-3">Waiting for the previous step</span>}
      </div>

      <div ref={outRef} className="max-h-[26rem] min-h-40 flex-1 overflow-y-auto px-3 py-2">
        {view === "output" ? (
          text ? (
            <div className="prose-nexus">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-[12.5px] text-ink-3">{active(s) ? "Waiting for the agent's first words…" : "No text output."}</p>
          )
        ) : (
          <ol className="flex flex-col gap-1 font-mono text-[11.5px]">
            {events
              .filter((e) => e.kind !== "text")
              .map((e) => (
                <li key={e.id} className={cx("flex gap-2", e.kind === "error" && "text-bad", e.kind === "stderr" && "text-warn", e.kind === "file" && "text-ok", e.kind === "tool" && "text-ink", (e.kind === "status" || e.kind === "system") && "text-ink-2")}>
                  <span className="shrink-0 text-ink-3">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                  <span className="shrink-0 uppercase text-ink-3">{e.kind === "tool-result" ? "result" : e.kind}</span>
                  <span className="min-w-0 break-all">{e.text}</span>
                </li>
              ))}
          </ol>
        )}
      </div>

      {files.length > 0 && (
        <div className="border-t border-line px-3 py-2">
          <p className="mb-1 text-[11.5px] font-medium text-ink-3">Files touched ({files.length})</p>
          <ul className="flex max-h-24 flex-col gap-0.5 overflow-y-auto font-mono text-[11.5px] text-ink-2">
            {files.map((f) => (
              <li key={f} className="truncate">
                {f.replace(s.cwd + "/", "")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="border-t border-line px-3 py-2">
        <dl className="tabular flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-ink-3">
          <div className="flex gap-1">
            <dt>Tokens in/out</dt>
            <dd className="text-ink-2">{s.usage ? `${fmtNum((s.usage.inputTokens ?? 0) + (s.usage.cacheReadTokens ?? 0) + (s.usage.cacheWriteTokens ?? 0))} / ${fmtNum(s.usage.outputTokens)}` : active(s) ? "…" : "Usage unavailable from this agent"}</dd>
          </div>
          {s.usage?.durationMs != null && (
            <div className="flex gap-1">
              <dt>Time</dt>
              <dd className="text-ink-2">{(s.usage.durationMs / 1000).toFixed(1)}s</dd>
            </div>
          )}
          {s.usage?.quota?.map((q) => (
            <div key={q.window} className="flex gap-1">
              <dt>{q.window} window</dt>
              <dd className="text-ink-2">{pct(q.utilization)} used</dd>
            </div>
          ))}
          <div className="flex gap-1">
            <dt>Style</dt>
            <dd className="text-ink-2">{CONCISE_LABELS[s.conciseMode]}</dd>
          </div>
        </dl>
        {s.usage && (
          <p className="mt-0.5 text-[10.5px] text-ink-3">
            Source: {s.usage.source}.{agent?.kind === "local-runtime" ? " Runs locally, no account usage." : " Input includes cached context. Nexus shows no dollar cost for subscription sessions."}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {active(s) && (
            <Button size="sm" variant="danger" onClick={() => act("cancel")} disabled={busy === "cancel"}>
              <CircleStop size={14} aria-hidden /> Stop
            </Button>
          )}
          {(s.status === "failed" || s.status === "cancelled") && !s.error && (
            <Button size="sm" onClick={() => act("retry")} disabled={!!busy}>
              <RotateCw size={14} aria-hidden /> Retry
            </Button>
          )}
          {canReview && (
            <Button size="sm" variant={s.status === "completed" ? "primary" : "secondary"} onClick={openDiff}>
              <FileCode2 size={14} aria-hidden /> Review diff
            </Button>
          )}
          {canReview && s.worktreeBranch && s.status === "completed" && (
            <Button size="sm" onClick={() => setConfirm("apply")}>
              <GitMerge size={14} aria-hidden /> Apply
            </Button>
          )}
          {s.status === "completed" && agent?.nexusCapabilities.includes("resume") && s.nativeSessionId && (
            <Button size="sm" variant="ghost" onClick={() => setRevise(true)}>
              <MessageSquareReply size={14} aria-hidden /> Ask for changes
            </Button>
          )}
          {canReview && scripts.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setCheck(scripts[0])}>
              <FlaskConical size={14} aria-hidden /> Run check
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setTermOpen(true)} aria-label="Show raw command and log">
            <SquareTerminal size={14} aria-hidden /> Log
          </Button>
          {canReview && s.worktreeBranch && s.status !== "applied" && (
            <Button size="sm" variant="ghost" onClick={() => setConfirm("discard")} aria-label="Discard changes">
              <Trash2 size={14} aria-hidden />
            </Button>
          )}
        </div>
        {checkResult && (
          <div className="mt-2">
            <p className={cx("text-[12px] font-medium", checkResult.ok ? "text-ok" : "text-bad")}>
              {checkResult.command}: {checkResult.ok ? "passed" : "failed"} in {(checkResult.durationMs / 1000).toFixed(1)}s
            </p>
            <pre className="term mt-1 max-h-48 overflow-auto rounded border border-line p-2 text-[11px] whitespace-pre-wrap text-ink-2">{checkResult.output || "(no output)"}</pre>
          </div>
        )}
      </footer>

      <Drawer
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        title={
          <div>
            <h2 className="text-[16px] font-semibold">Changes from {s.title}</h2>
            <p className="font-mono text-[12px] text-ink-3">
              {diff?.isolated ? `Worktree ${tidyPath(s.cwd)} on ${diff.branch}, compared with ${diff.base?.slice(0, 8)}` : `Folder ${tidyPath(s.cwd)} compared with ${s.baseRef?.slice(0, 8) ?? "HEAD"}`}
            </p>
          </div>
        }
        footer={
          s.worktreeBranch && s.status === "completed" ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={() => setConfirm("discard")}>Discard</Button>
              <Button variant="primary" onClick={() => setConfirm("apply")}>
                <GitMerge size={14} aria-hidden /> Apply to project
              </Button>
            </div>
          ) : undefined
        }
      >
        {diff ? <DiffView diff={diff} /> : <Spinner />}
      </Drawer>

      <Drawer open={termOpen} onClose={() => setTermOpen(false)} title={<h2 className="text-[16px] font-semibold">Session log</h2>}>
        <p className="mb-1 text-[12px] text-ink-3">Command (secrets redacted, brief shortened)</p>
        <pre className="term mb-3 overflow-x-auto rounded border border-line p-2 text-[11px] whitespace-pre-wrap text-ink">{s.command.join(" ") || "Not started"}</pre>
        <p className="mb-1 text-[12px] text-ink-3">
          Folder <span className="font-mono">{tidyPath(s.cwd)}</span>
          {s.nativeSessionId ? `, native session ${s.nativeSessionId}` : ""}
        </p>
        <pre className="term max-h-[60vh] overflow-auto rounded border border-line p-2 text-[11px] whitespace-pre-wrap text-ink-2">
          {events.map((e) => `${e.at.slice(11, 19)} ${e.kind.padEnd(11)} ${e.text}`).join("\n") || "No events yet."}
        </pre>
      </Drawer>

      <ConfirmDialog
        open={confirm === "apply"}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          if (await act("apply", { confirm: true })) {
            notify("Changes applied to your project as uncommitted edits.");
            setDiffOpen(false);
          }
        }}
        title="Apply these changes to your project?"
        body={<p>Nexus copies this session&apos;s changes into <span className="font-mono">{projectName}</span> as uncommitted edits. It does not commit or push. If files conflict, nothing is changed.</p>}
        confirmLabel="Apply changes"
      />
      <ConfirmDialog
        open={confirm === "discard"}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          if (await act("discard", { confirm: true })) {
            notify("Worktree and branch removed.");
            setDiffOpen(false);
          }
        }}
        title="Discard this session's changes?"
        body={<p>This deletes the worktree and its {s.worktreeBranch} branch. Your project folder is not touched. This can&apos;t be undone.</p>}
        confirmLabel="Discard changes"
        danger
      />
      <Dialog
        open={revise}
        onClose={() => setRevise(false)}
        title="Ask the agent for changes"
        footer={
          <>
            <Button onClick={() => setRevise(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!feedback.trim() || busy === "revise"}
              onClick={async () => {
                if (await act("revise", { feedback })) {
                  setRevise(false);
                  setFeedback("");
                  notify("Revision started in the same worktree.");
                }
              }}
            >
              Send to agent
            </Button>
          </>
        }
      >
        <p className="mb-2">The agent resumes its own session in the same folder with your note.</p>
        <label htmlFor={`fb-${s.id}`} className="sr-only">
          What to change
        </label>
        <textarea id={`fb-${s.id}`} value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={4} className={inputClass} placeholder="Make the signup form validate email addresses and show inline errors." />
      </Dialog>
      <Dialog
        open={!!check}
        onClose={() => setCheck(null)}
        title="Run a project check?"
        footer={
          <>
            <Button onClick={() => setCheck(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy === "check"}
              onClick={async () => {
                const script = check;
                setCheck(null);
                setBusy("check");
                setCheckResult(null);
                try {
                  setCheckResult(await api(`/api/sessions/${s.id}/check`, { body: { script, confirm: true } }));
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              Run it
            </Button>
          </>
        }
      >
        <label htmlFor={`chk-${s.id}`} className="mb-1 block text-[13px]">
          Script from the project&apos;s package.json
        </label>
        <select id={`chk-${s.id}`} value={check ?? ""} onChange={(e) => setCheck(e.target.value)} className={cx(inputClass, "mb-3")}>
          {scripts.map((sc) => (
            <option key={sc}>{sc}</option>
          ))}
        </select>
        <p className="mb-1">Nexus will run this in {s.worktreeBranch ? "the session's worktree" : "the project folder"}:</p>
        <pre className="term rounded border border-line p-2 text-[12px] text-ink">npm run {check}</pre>
        <p className="mt-2 text-[12px] text-ink-3">It runs the project&apos;s own script, which can do anything that script does. Up to 5 minutes.</p>
      </Dialog>
    </article>
  );
}

type ViewResp = { url: string | null; entry: string | null; devCommand: string | null; framework: string | null; path: string; version: number; error?: string };

/** One cursor colour per frame, like collaborators on a design canvas. */
const CURSOR = ["#f5a08b", "#9ec9f7", "#a9e0b5", "#caa8f7", "#f4d68a", "#f7a8cf"];

/** The agent's live cursor: drifts around its frame while the step runs. Purely a sign of activity. */
function AgentCursor({ name, color, seed }: { name: string; color: string; seed: number }) {
  return (
    <span aria-hidden className="agent-cursor pointer-events-none absolute z-10" style={{ animationDuration: `${7 + (seed % 4) * 1.7}s`, animationDelay: `${-seed * 1.3}s` }}>
      <svg width="18" height="18" viewBox="0 0 18 18" className="drop-shadow">
        <path d="M2 1.5 L16 8 L9.6 9.6 L7.6 16 Z" fill={color} stroke="#111" strokeWidth="1" strokeLinejoin="round" />
      </svg>
      <span className="ml-3 inline-block rounded-[3px] px-1.5 py-0.5 font-sans text-[12px] font-semibold whitespace-nowrap text-black" style={{ background: color }}>
        {name}
      </span>
    </span>
  );
}

/** One artboard on the canvas: a step's live output, or the builder's live page. */
function CanvasFrame({ s, idx, picked, onPick, preview, big }: { s: Session; idx: number; picked: boolean; onPick: () => void; preview: ViewResp | null; big: boolean }) {
  const { events, session } = useSessionStream(s.id);
  const cur = session ?? s;
  const { agents } = useWorkspace();
  const agent = agents.find((a) => a.id === cur.agentId);
  const running = cur.status === "running" || cur.status === "starting";
  const failed = cur.status === "failed" || cur.status === "cancelled";
  const done = ["completed", "applied"].includes(cur.status);
  const text = events.filter((e) => e.kind === "text").map((e) => e.text).join("").trim();
  const tail = text.slice(-900);
  const color = CURSOR[idx % CURSOR.length];
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail]);
  return (
    <div className={cx("flex min-h-0 flex-col", big ? "lg:col-span-7 lg:row-span-2" : "lg:col-span-5")}>
      <p className={cx("mb-1.5 truncate text-[13px]", running ? "text-[#7fb2ff]" : "text-white/55")}>{cur.title}</p>
      <button
        type="button"
        onClick={onPick}
        aria-pressed={picked}
        aria-label={`${cur.title}: ${agent?.displayName ?? cur.agentId}, ${cur.status}`}
        className={cx(
          "canvas-frame relative flex min-h-0 flex-1 overflow-hidden rounded-[2px] bg-[#0d0d0d] text-left outline-offset-0 transition-[outline-color]",
          big ? "min-h-[22rem]" : "min-h-[10.5rem]",
          running ? "outline outline-1 outline-[#4d8dff]" : failed ? "outline outline-1 outline-bad" : picked ? "outline outline-1 outline-white/60" : "outline outline-1 outline-white/10 hover:outline-white/30",
        )}
      >
        {running && (
          <>
            {["-left-[3px] -top-[3px]", "-right-[3px] -top-[3px]", "-left-[3px] -bottom-[3px]", "-right-[3px] -bottom-[3px]"].map((p) => (
              <span key={p} aria-hidden className={cx("absolute z-10 size-[6px] border border-[#4d8dff] bg-white", p)} />
            ))}
          </>
        )}
        {big && preview?.url ? (
          <iframe key={preview.version} src={preview.url} title="Live page" tabIndex={-1} className="pointer-events-none h-full min-h-[22rem] w-full bg-white" />
        ) : tail ? (
          <div ref={boxRef} className="h-full w-full overflow-hidden p-4 text-[13px] leading-relaxed whitespace-pre-wrap text-white/80 [mask-image:linear-gradient(to_bottom,transparent,black_30%)]">
            {tail}
          </div>
        ) : (
          <div className="grid h-full w-full place-items-center">
            <span className={cx("font-display text-[22px]", failed ? "text-bad" : "text-white/35")}>{failed ? "Stopped" : done ? "Done" : running ? "Starting" : "Waiting"}</span>
          </div>
        )}
        {running && agent && <AgentCursor name={agent.displayName} color={color} seed={idx} />}
        {done && !big && (
          <span aria-hidden className="absolute right-2 bottom-2 grid size-6 place-items-center rounded-full bg-ok text-black">
            <Check size={14} />
          </span>
        )}
      </button>
    </div>
  );
}

/** The run as a design canvas: every step an artboard, the builder's live page the big one. */
function SwarmCanvas({ sessions, picked, onPick }: { sessions: Session[]; picked: string; onPick: (id: string) => void }) {
  const ordered = [...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const target = [...ordered].reverse().find((x) => x.permissions.editFiles && x.status !== "discarded");
  const live = ordered.some(active);
  const hasOutput = !!target && ["running", "completed", "applied"].includes(target.status);
  const view = useApi<ViewResp>(hasOutput ? `/api/view?session=${target!.id}` : null, { interval: live ? 5000 : 0 });
  const v = view.data ?? null;
  const big = target ?? ordered[ordered.length - 1];
  const others = ordered.filter((x) => x.id !== big?.id);
  return (
    <section aria-label="Canvas" className="force-dark canvas-ground mb-4 overflow-hidden rounded-[var(--radius-panel)] border border-white/10 p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="flex -space-x-1.5" aria-hidden>
          {ordered.filter(active).map((x, i) => (
            <span key={x.id} className="size-3 rounded-full ring-2 ring-[#1b1b1b]" style={{ background: CURSOR[ordered.indexOf(x) % CURSOR.length] }} data-i={i} />
          ))}
        </span>
        <span className="text-[15px] text-white/80">{live ? `${ordered.filter((x) => x.status === "running").length} agents working in parallel` : "All agents finished"}</span>
        <span className="ml-auto flex gap-1.5">
          {v?.url && (
            <a href={v.url} target="_blank" rel="noreferrer" className="btn-step rounded-[var(--radius-control)] border border-white/20 px-3 py-1.5 text-[13px] text-white/85 hover:bg-white/10">
              Open the page
            </a>
          )}
          {target && (
            <button type="button" onClick={() => api("/api/reveal", { body: { sessionId: target.id } }).catch(() => {})} className="btn-step rounded-[var(--radius-control)] border border-white/20 px-3 py-1.5 text-[13px] text-white/85 hover:bg-white/10">
              Show in Finder
            </button>
          )}
        </span>
      </div>
      <div className="grid gap-x-6 gap-y-5 lg:grid-cols-12" style={{ gridAutoRows: "minmax(12rem, auto)" }}>
        {big && <CanvasFrame s={big} idx={ordered.indexOf(big)} picked={picked === big.id} onPick={() => onPick(big.id)} preview={v} big />}
        {others.map((x) => (
          <CanvasFrame key={x.id} s={x} idx={ordered.indexOf(x)} picked={picked === x.id} onPick={() => onPick(x.id)} preview={null} big={false} />
        ))}
      </div>
      {big && hasOutput && v && !v.url && v.devCommand && (
        <p className="mt-4 text-[14px] text-white/75">
          This {v.framework ?? "project"} needs its dev server: <code className="font-mono">{v.devCommand}</code>
        </p>
      )}
    </section>
  );
}

/** One line at the top that says where the run stands, so a stopped run never looks idle. */
function RunStatus({ sessions, onPick }: { sessions: Session[]; onPick: (id: string) => void }) {
  const running = sessions.filter(active);
  const failed = sessions.filter((x) => x.status === "failed" && !x.optional);
  const done = sessions.every((x) => ["completed", "applied", "discarded"].includes(x.status) || (x.optional && x.status === "failed"));
  const handed = sessions.filter((x) => x.notice && active(x));
  let tone = "border-line bg-surface";
  let text: string;
  if (failed.length && !running.length) {
    return (
      <p role="status" aria-live="polite" className="mb-4 rounded-[var(--radius-control)] border border-bad/40 bg-bad-soft px-4 py-3 text-[15px] text-ink">
        Stopped at &ldquo;{failed[0].title}&rdquo;.{" "}
        <button type="button" onClick={() => onPick(failed[0].id)} className="font-medium text-accent underline underline-offset-2">
          Fix it on that step
        </button>
        : sign in, retry, or run it with another agent. The steps after it start again by themselves.
      </p>
    );
  } else if (running.length) {
    const now = running.filter((x) => x.status === "running").map((x) => x.title);
    text = now.length ? `Working: ${now.join(", ")}. ${running.length - now.length ? `${running.length - now.length} waiting.` : ""}` : `${running.length} step${running.length > 1 ? "s" : ""} waiting to start.`;
    if (handed.length) text += ` ${handed[0].notice}`;
  } else if (done) {
    tone = "border-ok/40 bg-ok-soft";
    text = "All steps finished. Check the page, review the diff, then Apply to copy the result into your project.";
  } else text = "Some steps were stopped. Retry them below.";
  return (
    <p role="status" aria-live="polite" className={cx("mb-4 rounded-[var(--radius-control)] border px-4 py-3 text-[15px] text-ink", tone)}>
      {text}
    </p>
  );
}

export function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const wf = useApi<WorkflowResp>(`/api/workflows/${id}`, { interval: 3000 });
  const proj = useApi<{ scripts: string[]; project: { name: string } }>(wf.data ? `/api/projects/${wf.data.workflow.projectId}` : null);
  const [toast, setToast] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const notify = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 4000);
  };
  if (wf.error && !wf.data) return <p className="text-bad">{wf.error}</p>;
  if (!wf.data) return <Spinner />;
  const { workflow, sessions, overlaps } = wf.data;
  const lanes = [...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // One step on screen at a time: the one you picked, else the one that needs you, else the last builder.
  const auto = lanes.find((x) => x.status === "failed" && !x.optional) ?? lanes.find((x) => x.status === "running") ?? [...lanes].reverse().find((x) => x.permissions.editFiles) ?? lanes[lanes.length - 1];
  const shown = lanes.some((x) => x.id === pick) ? pick! : auto?.id ?? "";
  return (
    <div className="w-full">
      <header className="page-sky mb-4 flex flex-wrap items-center gap-3 overflow-hidden rounded-[var(--radius-panel)] border border-white/15 px-4 py-5 text-white sm:px-6">
        <Link href="/runs" className="btn-step rounded-[var(--radius-control)] border border-white/20 px-3 py-1.5 text-[14px] text-white/85 hover:bg-white/10">
          Runs
        </Link>
        <h2 className="font-display min-w-0 flex-1 truncate text-[24px] leading-tight sm:text-[30px]">{workflow.name}</h2>
        <details className="relative">
          <summary className="btn-step cursor-pointer list-none rounded-[var(--radius-control)] border border-white/20 px-3 py-1.5 text-[14px] text-white/85 hover:bg-white/10">Prompt</summary>
          <pre className="term absolute right-0 z-20 mt-2 max-h-96 w-[min(90vw,720px)] overflow-auto rounded border border-line bg-canvas p-4 text-[13px] whitespace-pre-wrap text-ink-2">{workflow.brief}</pre>
        </details>
        <Button
          variant={workflow.saved ? "secondary" : "primary"}
          onClick={async () => {
            await api(`/api/workflows/${id}`, { method: "PATCH", body: { saved: !workflow.saved } });
            wf.reload();
            notify(workflow.saved ? "Removed from saved workflows" : "Workflow saved");
          }}
        >
          <Bookmark size={14} fill={workflow.saved ? "currentColor" : "none"} aria-hidden /> {workflow.saved ? "Saved" : "Save"}
        </Button>
      </header>
      <RunStatus sessions={sessions} onPick={setPick} />
      <SwarmCanvas sessions={sessions} picked={shown} onPick={setPick} />
      {overlaps.length > 0 && (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-[var(--radius-control)] border border-warn/40 bg-warn-soft px-4 py-3 text-[15px] text-ink">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <span>
            Overlapping edits: {overlaps.map((o) => o.file).slice(0, 6).join(", ")}
            {overlaps.length > 6 ? ` and ${overlaps.length - 6} more` : ""} changed in more than one session. Apply one, then re-check the other.
          </span>
        </p>
      )}
      {lanes
        .filter((s) => s.id === shown)
        .map((s) => (
          <SessionLane key={s.id} s0={s} scripts={proj.data?.scripts ?? []} projectName={proj.data?.project.name ?? "the project"} onChanged={wf.reload} notify={notify} />
        ))}
      <Toast message={toast} />
    </div>
  );
}
