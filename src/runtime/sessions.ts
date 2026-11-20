import { EventEmitter } from "node:events";
import fs from "node:fs";
import { getDb } from "./db";
import { audit } from "./audit";
import { newId } from "./ids";
import { redact } from "./redact";
import { getSettings } from "./settings";
import { canLaunch, detectAll, getAdapter, invalidateDetection } from "./agents/registry";
import { bestModel } from "@/lib/model-pick";
import { startPowerWatch, waitForNetwork } from "./power";
import { describe, limitsFor, resetsAt } from "./limits";
import { notesContext } from "./notes";
import { MAP_FILE, MAP_INSTRUCTION, buildMap, writeMap } from "./project-map";
import { canHandOff, classifyFailure } from "@/lib/failure";
import { parseReset } from "@/lib/limit-reset";
import type { RunningHandle } from "./agents/types";
import { createWorktree, diff, getProject, isRepo } from "./workspace";
import type { AgentEvent, AgentEventKind, ConciseMode, PermissionSet, PresetId, Session, SessionRole, Workflow } from "@/lib/types";

/**
 * Session store + orchestrator. State lives in SQLite; live handles live in memory.
 * A session is "running" only while its child process (or local stream) is alive.
 */

type RawLine = { n: number; at: string; stream: "out" | "err"; line: string };
type Globals = { bus: EventEmitter; handles: Map<string, RunningHandle>; queue: string[]; recovered: boolean; raw?: Map<string, RawLine[]>; rawSeq?: number };
const g = globalThis as unknown as { __nexus?: Globals };
g.__nexus ??= { bus: new EventEmitter(), handles: new Map(), queue: [], recovered: false };
const state = g.__nexus;
state.raw ??= new Map();
state.rawSeq ??= 0;
const RAW_CAP = 4000;

/**
 * Raw output lines of each agent process (stdout and stderr), redacted, kept in memory only
 * (the last 4000 per session). The Advanced workspace shows them as the agent's terminal.
 */
function pushRaw(sessionId: string, stream: "out" | "err", line: string) {
  const buf = state.raw!.get(sessionId) ?? [];
  const r: RawLine = { n: ++state.rawSeq!, at: new Date().toISOString(), stream, line: redact(line).slice(0, 4000) };
  buf.push(r);
  if (buf.length > RAW_CAP) buf.splice(0, buf.length - RAW_CAP);
  state.raw!.set(sessionId, buf);
  bus.emit("raw", { sessionId, ...r });
}

export function rawLines(sessionId: string, after = 0): RawLine[] {
  return (state.raw!.get(sessionId) ?? []).filter((r) => r.n > after);
}

/** OS process ids of agents running right now, by session. */
export function runningPids(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, h] of state.handles) if (h.pid) out[id] = h.pid;
  return out;
}
state.bus.setMaxListeners(200);

export const bus = state.bus;

// ---------- persistence ----------

export function saveSession(s: Session) {
  getDb()
    .prepare("INSERT INTO sessions (id, data, project_id, workflow_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .run(s.id, JSON.stringify(s), s.projectId, s.workflowId, s.createdAt);
  bus.emit("session", s);
}

export function getSession(id: string): Session | null {
  recover();
  const r = getDb().prepare("SELECT data FROM sessions WHERE id = ?").get(id) as { data: string } | undefined;
  return r ? (JSON.parse(r.data) as Session) : null;
}

export function listSessions(opts: { projectId?: string; workflowId?: string; limit?: number } = {}): Session[] {
  recover();
  let sql = "SELECT data FROM sessions";
  const where: string[] = [];
  const args: string[] = [];
  if (opts.projectId) {
    where.push("project_id = ?");
    args.push(opts.projectId);
  }
  if (opts.workflowId) {
    where.push("workflow_id = ?");
    args.push(opts.workflowId);
  }
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += ` ORDER BY created_at DESC LIMIT ${Math.min(opts.limit ?? 200, 500)}`;
  return (getDb().prepare(sql).all(...args) as { data: string }[]).map((r) => JSON.parse(r.data) as Session);
}

function update(id: string, patch: Partial<Session> | ((s: Session) => Partial<Session>)) {
  const s = getSession(id);
  if (!s) return null;
  const next = { ...s, ...(typeof patch === "function" ? patch(s) : patch) };
  saveSession(next);
  return next;
}

export function addEvent(sessionId: string, kind: AgentEventKind, text: string, data?: Record<string, unknown>): AgentEvent {
  const at = new Date().toISOString();
  const clean = redact(text).slice(0, 20_000);
  const r = getDb().prepare("INSERT INTO events (session_id, at, kind, text, data) VALUES (?, ?, ?, ?, ?)").run(sessionId, at, kind, clean, data ? JSON.stringify(data) : null);
  const ev: AgentEvent = { id: Number(r.lastInsertRowid), sessionId, at, kind, text: clean, data };
  bus.emit(`events:${sessionId}`, ev);
  bus.emit("event", ev);
  return ev;
}

export function listEvents(sessionId: string, afterId = 0): AgentEvent[] {
  return (
    getDb().prepare("SELECT id, session_id, at, kind, text, data FROM events WHERE session_id = ? AND id > ? ORDER BY id LIMIT 5000").all(sessionId, afterId) as {
      id: number;
      session_id: string;
      at: string;
      kind: AgentEventKind;
      text: string;
      data: string | null;
    }[]
  ).map((r) => ({ id: r.id, sessionId: r.session_id, at: r.at, kind: r.kind, text: r.text, data: r.data ? JSON.parse(r.data) : undefined }));
}

/** After a server restart, nothing from before can still be running. Say so instead of pretending. */
function recover() {
  if (state.recovered) return;
  state.recovered = true;
  const timer = setInterval(runDueResets, 20_000);
  timer.unref?.();
  const rows = getDb().prepare("SELECT data FROM sessions").all() as { data: string }[];
  for (const r of rows) {
    const s = JSON.parse(r.data) as Session;
    if (["running", "starting", "queued"].includes(s.status) && !state.handles.has(s.id)) {
      s.status = "failed";
      s.error = "Nexus restarted while this session was active. Its process is no longer attached.";
      s.endedAt = s.endedAt ?? new Date().toISOString();
      getDb().prepare("UPDATE sessions SET data = ? WHERE id = ?").run(JSON.stringify(s), s.id);
    }
  }
}

/** Steps waiting for a usage limit to reset run again once their time has come. */
function runDueResets() {
  const now = Date.now();
  for (const s of listSessions({ limit: 500 })) {
    if (!s.retryAt || Date.parse(s.retryAt) > now) continue;
    if (s.status === "failed") {
      addEvent(s.id, "system", "The usage limit has reset. Running this step again.");
      retry(s.id);
    } else if (s.status === "queued" && !state.queue.includes(s.id) && !state.handles.has(s.id)) {
      // A step held before it started because its agent was at 100%.
      update(s.id, { retryAt: null, notice: null });
      addEvent(s.id, "system", "The usage limit has reset. Starting this step.");
      state.queue.push(s.id);
      pump();
    }
  }
}

/** Stops waiting for a limit reset, or waits again for the reset time the agent reported. */
export function setResetWait(sessionId: string, wait: boolean): Session {
  const s = getSession(sessionId);
  if (!s) throw new Error("Session not found.");
  if (!wait && s.status === "queued") {
    // Held for a reset: the person chose to run it now anyway.
    const next = update(sessionId, { retryAt: null, ignoreLimit: true, notice: null })!;
    addEvent(sessionId, "system", "Running now without waiting for the limit to reset.");
    if (!state.queue.includes(sessionId)) state.queue.push(sessionId);
    pump();
    return next;
  }
  if (!wait) return update(sessionId, { retryAt: null, notice: "Nexus won't run this step again by itself." })!;
  const at = parseReset(s.error);
  if (!at) throw new Error("The agent did not say when its limit resets.");
  return update(sessionId, { retryAt: new Date(at).toISOString(), notice: `Runs again at ${new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, when the usage limit resets.` })!;
}

// ---------- workflows ----------

export function saveWorkflow(w: Workflow) {
  getDb()
    .prepare("INSERT INTO workflows (id, project_id, name, preset, goal, brief, created_at, saved) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, brief = excluded.brief, saved = excluded.saved")
    .run(w.id, w.projectId, w.name, w.preset, w.goal, w.brief, w.createdAt, w.saved ? 1 : 0);
}

type WRow = { id: string; project_id: string; name: string; preset: PresetId; goal: string; brief: string; created_at: string; saved: number };
const toWorkflow = (r: WRow): Workflow => ({ id: r.id, projectId: r.project_id, name: r.name, preset: r.preset, goal: r.goal, brief: r.brief, createdAt: r.created_at, saved: !!r.saved });

export function getWorkflow(id: string) {
  const r = getDb().prepare("SELECT * FROM workflows WHERE id = ?").get(id) as WRow | undefined;
  return r ? toWorkflow(r) : null;
}

export function listWorkflows(opts: { savedOnly?: boolean } = {}) {
  return (getDb().prepare(`SELECT * FROM workflows ${opts.savedOnly ? "WHERE saved = 1" : ""} ORDER BY created_at DESC LIMIT 200`).all() as WRow[]).map(toWorkflow);
}

/** Planners, reviewers and agents that can't edit files always run read-only. */
function readOnlyRole(role: SessionRole, agentId: string) {
  return role === "plan" || role === "review" || role === "copy" || !getAdapter(agentId)?.meta.nexusCapabilities.includes("edits-project");
}

export type TaskSpec = {
  role: SessionRole;
  agentId: string;
  title: string;
  brief: string;
  model?: string | null;
  dependsOnIndex?: number | null;
  /** Team builds: every earlier step that must finish first. */
  afterIndexes?: number[];
  /** Team builds: reuse the worktree of this earlier step. */
  shareWorktreeOfIndex?: number | null;
  optional?: boolean;
};

export async function createWorkflow(input: {
  projectId: string;
  preset: PresetId;
  goal: string;
  brief: string;
  tasks: TaskSpec[];
  skills: string[];
  concise: ConciseMode;
  permissions: PermissionSet;
  attachments?: string[];
}): Promise<{ workflow: Workflow; sessions: Session[] }> {
  const project = getProject(input.projectId);
  if (!project) throw new Error("Project not found.");
  const wf: Workflow = {
    id: newId("wf"),
    projectId: project.id,
    name: input.goal.split("\n")[0].slice(0, 80),
    preset: input.preset,
    goal: input.goal,
    brief: input.brief,
    createdAt: new Date().toISOString(),
    saved: false,
  };
  saveWorkflow(wf);
  const sessions: Session[] = [];
  for (const t of input.tasks) {
    const after = Array.from(new Set([...(t.afterIndexes ?? []), ...(t.dependsOnIndex != null ? [t.dependsOnIndex] : [])]))
      .map((i) => sessions[i]?.id)
      .filter((x): x is string => !!x);
    const s: Session = {
      id: newId("ses"),
      workflowId: wf.id,
      projectId: project.id,
      agentId: t.agentId,
      role: t.role,
      title: t.title,
      brief: t.brief,
      status: "queued",
      cwd: project.path,
      worktreeBranch: null,
      baseRef: null,
      nativeSessionId: null,
      parentSessionId: null,
      dependsOn: after[0] ?? null,
      after,
      shareWorktreeOf: t.shareWorktreeOfIndex != null ? sessions[t.shareWorktreeOfIndex]?.id ?? null : null,
      optional: !!t.optional,
      permissions: readOnlyRole(t.role, t.agentId) ? { ...input.permissions, editFiles: false, isolate: false, runShell: false } : { ...input.permissions },
      conciseMode: input.concise,
      skills: input.skills,
      attachments: input.attachments ?? [],
      model: t.model ?? null,
      command: [],
      usage: null,
      error: null,
      summary: null,
      createdAt: new Date(Date.now() + sessions.length).toISOString(),
      startedAt: null,
      endedAt: null,
    };
    saveSession(s);
    sessions.push(s);
  }
  audit("workflow.create", `${wf.id} preset=${wf.preset} project=${project.path} tasks=${sessions.map((s) => `${s.role}:${s.agentId}`).join(",")}`);
  for (const s of sessions) state.queue.push(s.id);
  pump();
  return { workflow: wf, sessions };
}

/** Starts a follow-up turn on a finished session, in the same folder, resuming the agent's native session. */
export function revise(sessionId: string, feedback: string): Session {
  const parent = getSession(sessionId);
  if (!parent) throw new Error("Session not found.");
  const adapter = getAdapter(parent.agentId);
  if (!adapter?.launch) throw new Error("This agent cannot be revised from Nexus.");
  const s: Session = {
    ...parent,
    id: newId("ses"),
    role: "revise",
    title: `Revision of ${parent.title}`,
    brief: feedback,
    status: "queued",
    parentSessionId: parent.id,
    dependsOn: null,
    usage: null,
    error: null,
    summary: null,
    command: [],
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
  };
  saveSession(s);
  audit("session.revise", `${s.id} from ${parent.id}`);
  state.queue.push(s.id);
  pump();
  return s;
}

export function retry(sessionId: string): Session {
  const s = update(sessionId, { status: "queued", error: null, summary: null, usage: null, startedAt: null, endedAt: null, notice: null, retryAt: null, ignoreLimit: false });
  if (!s) throw new Error("Session not found.");
  addEvent(s.id, "system", "Retry requested.");
  state.queue.push(s.id);
  requeueSkipped(s.id);
  pump();
  return s;
}

/** Runs a failed or stopped step again with a different agent the user picked. */
export async function reassign(sessionId: string, agentId: string, model: string | null): Promise<Session> {
  const s = getSession(sessionId);
  if (!s) throw new Error("Session not found.");
  if (!["failed", "cancelled", "queued"].includes(s.status)) throw new Error("Only waiting, failed or stopped steps can be moved to another agent.");
  const a = (await detectAll(true)).find((x) => x.id === agentId);
  if (!a || !canLaunch(a)) throw new Error("That agent is not installed and signed in, so it can't take this step.");
  if (!fits(s, a)) throw new Error(`${a.displayName} can't do this step (${s.permissions.editFiles ? "it needs an agent that edits files" : "wrong capability"}).`);
  const from = getAdapter(s.agentId)?.meta.displayName ?? s.agentId;
  const next = update(s.id, {
    agentId: a.id,
    model: model ?? bestModel(a, s.role),
    triedAgents: Array.from(new Set([...(s.triedAgents ?? []), s.agentId])),
    status: "queued",
    error: null,
    summary: null,
    usage: null,
    nativeSessionId: null,
    command: [],
    startedAt: null,
    endedAt: null,
    retryAt: null,
    ignoreLimit: false,
    notice: `Moved from ${from} to ${a.displayName} by you.`,
  })!;
  addEvent(s.id, "system", `Moved from ${from} to ${a.displayName}.`);
  audit("session.reassign", `${s.id} ${s.agentId} -> ${a.id}`);
  state.queue.push(s.id);
  requeueSkipped(s.id);
  pump();
  return next;
}

export function cancel(sessionId: string) {
  const h = state.handles.get(sessionId);
  state.queue = state.queue.filter((id) => id !== sessionId);
  if (h) {
    h.cancel();
    addEvent(sessionId, "system", "Stop requested.");
  } else {
    const s = getSession(sessionId);
    if (s && (s.status === "queued" || s.status === "starting")) {
      update(sessionId, { status: "cancelled", endedAt: new Date().toISOString(), error: "Stopped before it started." });
      cascadeBlocked(sessionId);
    }
  }
  audit("session.cancel", sessionId);
}

export function markReview(sessionId: string, status: "applied" | "discarded") {
  return update(sessionId, { status });
}

/** Records files copied into the project by a partial Apply. */
export function markAppliedFiles(sessionId: string, files: string[], total: number) {
  return update(sessionId, (s) => {
    const done = Array.from(new Set([...(s.appliedFiles ?? []), ...files]));
    return { appliedFiles: done, notice: `Applied ${done.length} of ${total} changed files to your project. The rest stay in the worktree.` };
  });
}

export function runningCount() {
  return state.handles.size;
}

// ---------- scheduler ----------

const depsOf = (s: Session) => (s.after?.length ? s.after : s.dependsOn ? [s.dependsOn] : []);

function cascadeBlocked(failedId: string) {
  const failed = getSession(failedId);
  if (failed?.optional) return; // optional steps never block the steps after them
  for (const s of listSessions({ limit: 500 })) {
    if (depsOf(s).includes(failedId) && s.status === "queued") {
      update(s.id, { status: "cancelled", error: "Skipped because the step it depends on did not finish.", endedAt: new Date().toISOString() });
      state.queue = state.queue.filter((id) => id !== s.id);
      cascadeBlocked(s.id);
    }
  }
}

/** Steps skipped because this one failed go back in the queue when it runs again. */
function requeueSkipped(id: string) {
  for (const d of listSessions({ limit: 500 })) {
    if (depsOf(d).includes(id) && d.status === "cancelled" && d.error?.startsWith("Skipped because")) {
      update(d.id, { status: "queued", error: null, endedAt: null });
      addEvent(d.id, "system", "Back in the queue: the step it waits for is running again.");
      state.queue.push(d.id);
      requeueSkipped(d.id);
    }
  }
}

/** Whether an agent can do this kind of step. */
function fits(s: Session, a: { nexusCapabilities: string[]; kind: string }) {
  if (s.role === "assets") return a.nexusCapabilities.includes("images");
  if (s.permissions.editFiles) return a.nexusCapabilities.includes("edits-project");
  return true;
}

/**
 * When an agent can't run a step for a reason another agent doesn't share (expired sign-in,
 * usage limit, missing binary), give the step to the next ready agent that fits it, and say so.
 * Returns false when nobody else can take it.
 */
async function handOff(sid: string, error: string): Promise<boolean> {
  const kind = classifyFailure(error);
  if (!canHandOff(kind)) return false;
  invalidateDetection();
  const s = getSession(sid);
  if (!s || s.role === "revise" || !s.workflowId) return false;
  const tried = Array.from(new Set([...(s.triedAgents ?? []), s.agentId]));
  const agents = await detectAll(true);
  const pool = agents.filter((a) => canLaunch(a) && !tried.includes(a.id) && fits(s, a));
  // Prefer account agents over local models for real work; local models are the last resort.
  const next = pool.sort((a, b) => Number(a.kind === "local-runtime") - Number(b.kind === "local-runtime"))[0];
  if (!next) return false;
  const from = getAdapter(s.agentId)?.meta.displayName ?? s.agentId;
  const why = kind === "sign-in" ? "its sign-in expired or is missing" : kind === "limit" ? "it hit a usage limit" : "it is not available";
  const notice = `${from} could not run this step because ${why}. Nexus handed it to ${next.displayName}.`;
  update(sid, {
    agentId: next.id,
    model: bestModel(next, s.role),
    triedAgents: tried,
    status: "queued",
    error: null,
    summary: null,
    usage: null,
    nativeSessionId: null,
    command: [],
    startedAt: null,
    endedAt: null,
    notice,
  });
  addEvent(sid, "system", `${notice} (${from} said: ${error.slice(0, 300)})`);
  audit("session.handoff", `${sid} ${s.agentId} -> ${next.id} (${kind})`);
  state.queue.push(sid);
  return true;
}

function pump() {
  startPowerWatch(
    () => state.handles.size > 0 || state.queue.length > 0,
    (ids) => {
      for (const id of ids) {
        const s = getSession(id);
        if (s?.status !== "failed") continue;
        addEvent(id, "system", "The network is back. Running this step again.");
        retry(id);
      }
    },
  );
  const limit = Math.max(1, Math.min(8, getSettings().concurrency));
  for (const id of [...state.queue]) {
    if (state.handles.size >= limit) break;
    const s = getSession(id);
    if (!s || s.status !== "queued") {
      state.queue = state.queue.filter((x) => x !== id);
      continue;
    }
    const deps = depsOf(s).map((d) => getSession(d));
    if (deps.some((d) => !d)) continue;
    const blocking = deps.find((d) => (d!.status === "failed" || d!.status === "cancelled") && !d!.optional);
    if (blocking) {
      cascadeBlocked(blocking.id);
      continue;
    }
    if (!deps.every((d) => ["completed", "applied", "discarded", "failed", "cancelled"].includes(d!.status))) continue;
    state.queue = state.queue.filter((x) => x !== id);
    void start(s);
  }
}

async function contextFor(s: Session): Promise<string | undefined> {
  const parts: string[] = [];
  for (const id of depsOf(s)) {
    const dep = getSession(id);
    if (!dep) continue;
    if (dep.status === "failed" || dep.status === "cancelled") {
      parts.push(`The "${dep.title}" step did not finish (${dep.error ?? dep.status}). Work without it.`);
      continue;
    }
    if (s.role === "review" && dep.permissions.editFiles) {
      const d = await diff(dep.cwd, dep.baseRef);
      if ("error" in d) parts.push(`The diff of "${dep.title}" is unavailable: ${d.error}`);
      else parts.push(`Diff produced by "${dep.title}" (${d.files.length} files, binary files listed only):\n${d.patch.slice(0, 60_000)}`);
      continue;
    }
    if (dep.summary) parts.push(`Output of the "${dep.title}" step (${dep.agentId}):\n${dep.summary.slice(0, 20_000)}`);
  }
  return parts.length ? parts.join("\n\n---\n\n") : undefined;
}

async function start(s0: Session) {
  const adapter = getAdapter(s0.agentId);
  const project = getProject(s0.projectId);
  let s = update(s0.id, { status: "starting", startedAt: new Date().toISOString() })!;
  // Reserve a slot before any await so the limit holds.
  const placeholder: RunningHandle = { done: Promise.resolve({ ok: false }), cancel: () => {} };
  state.handles.set(s.id, placeholder);
  const fail = (error: string) => {
    state.handles.delete(s.id);
    update(s.id, { status: "failed", error, endedAt: new Date().toISOString() });
    addEvent(s.id, "error", error);
    cascadeBlocked(s.id);
    pump();
  };
  if (!adapter?.launch) return fail("Nexus has no launch support for this agent.");
  if (!project) return fail("The project no longer exists in Nexus.");
  // Don't launch an agent we already know can't run; hand the step on instead.
  const status = (await detectAll()).find((a) => a.id === s.agentId);
  if (status && !canLaunch(status)) {
    const why =
      status.install !== "installed"
        ? `${adapter.meta.displayName} is not installed.`
        : status.kind === "local-runtime" && !status.models.length
          ? `${adapter.meta.displayName} has no model pulled, so it is not available.`
          : `${adapter.meta.displayName} is not signed in. ${status.authDetail}`;
    state.handles.delete(s.id);
    if (await handOff(s.id, why)) return pump();
    state.handles.set(s.id, placeholder);
    return fail(why);
  }
  // The agent already reported a full usage limit: hand the step on before it fails.
  const lim = s.ignoreLimit ? null : limitsFor(s.agentId);
  if (lim?.level === "out") {
    state.handles.delete(s.id);
    if (await handOff(s.id, `${describe(lim)} Its usage limit is reached.`)) return pump();
    // Nobody else can take it: hold the step until the full window resets, then start it.
    const at = resetsAt(lim);
    if (at) {
      const when = new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      update(s.id, { status: "queued", startedAt: null, retryAt: new Date(at).toISOString(), notice: `Waiting for ${lim.agentName}'s limit to reset at ${when}. It starts then by itself.` });
      addEvent(s.id, "system", `${describe(lim)} No other agent can take this step, so Nexus starts it at ${when}, when the limit resets.`);
      return pump();
    }
    state.handles.set(s.id, placeholder);
    addEvent(s.id, "system", `${describe(lim)} No other agent can take this step and the agent gave no reset time, so Nexus runs it anyway.`);
  } else if (lim?.level === "near") {
    addEvent(s.id, "system", `${describe(lim)} You can move this step to another agent.`);
  }

  // Team builds: later steps work in the worktree an earlier step created.
  const shared = s.shareWorktreeOf ? getSession(s.shareWorktreeOf) : null;
  if (shared?.worktreeBranch && !s.worktreeBranch) {
    s = update(s.id, { cwd: shared.cwd, worktreeBranch: shared.worktreeBranch, baseRef: shared.baseRef })!;
    addEvent(s.id, "system", `Working in the shared team worktree on ${shared.worktreeBranch}, with the files from "${shared.title}".`);
  }
  // Read-only steps after a worktree step (reviewers) read that worktree, not the project folder.
  if (!s.permissions.editFiles && !shared && s.role !== "revise") {
    const src = depsOf(s).map((d) => getSession(d)).find((d) => d?.worktreeBranch && fs.existsSync(d.cwd));
    if (src) {
      s = update(s.id, { cwd: src.cwd })!;
      addEvent(s.id, "system", `Reading the worktree of "${src.title}" (${src.worktreeBranch}).`);
    }
  }
  // Isolation: each editing session gets its own worktree when the project is a git repo.
  if (s.role !== "revise" && s.permissions.editFiles && s.permissions.isolate && !s.worktreeBranch && adapter.meta.nexusCapabilities.includes("edits-project")) {
    if (await isRepo(project.path)) {
      const wt = await createWorktree(project.path, s.id);
      if (!wt.ok) return fail(wt.error);
      s = update(s.id, { cwd: wt.path, worktreeBranch: wt.branch, baseRef: wt.base })!;
      addEvent(s.id, "system", `Isolated worktree on branch ${wt.branch}, based on ${wt.base.slice(0, 8)}. Uncommitted changes in your project are not included.`);
    } else {
      addEvent(s.id, "system", "Project is not a git repository, so this session edits the folder directly and diff review is unavailable.");
      s = update(s.id, { permissions: { ...s.permissions, isolate: false } })!;
    }
  } else if (!s.baseRef && s.permissions.editFiles && (await isRepo(s.cwd))) {
    // Non-isolated session in a repo: diff against HEAD at start.
    const { run } = await import("./proc");
    const head = await run("git", ["rev-parse", "HEAD"], { cwd: s.cwd });
    if (head.code === 0) s = update(s.id, { baseRef: head.stdout.trim() })!;
  }

  const parent = s.parentSessionId ? getSession(s.parentSessionId) : null;
  let ctx = await contextFor(s);
  // The user's project notes go to every new step, so they don't explain the same rules twice.
  const notes = s.role === "revise" ? null : notesContext(s.projectId);
  if (notes) {
    ctx = [notes, ctx].filter(Boolean).join("\n\n---\n\n");
    addEvent(s.id, "system", `Gave the agent your project notes (${notes.split("\n").length - 1} lines).`);
  }
  // One-file project map, so the agent doesn't spend its turn listing folders and opening files.
  if (getSettings().projectMap && s.role !== "revise") {
    try {
      if (adapter.meta.kind === "local-runtime") {
        // A local model can't open files, so it gets a short excerpt inline.
        const m = await buildMap(s.cwd);
        ctx = [ctx, `Project map (files, sizes, names they define):\n${m.text.slice(0, 8000)}`].filter(Boolean).join("\n\n---\n\n");
      } else {
        const m = await writeMap(s.cwd);
        if ("error" in m) addEvent(s.id, "system", `No project map: ${m.error}`);
        else {
          ctx = [MAP_INSTRUCTION, ctx].filter(Boolean).join("\n\n");
          addEvent(s.id, "system", `Wrote ${MAP_FILE} (${m.files} files, ${Math.round(m.bytes / 1024)} KB${m.truncated ? ", cut off" : ""}) and told the agent to read it first. It is excluded from git.`);
        }
      }
    } catch (e) {
      addEvent(s.id, "system", `No project map: ${(e as Error).message}`);
    }
  }
  if (state.handles.get(s.id) !== placeholder) return; // cancelled meanwhile
  const sid = s.id;
  let handle: RunningHandle;
  try {
    handle = adapter.launch(
      {
        sessionId: sid,
        brief: s.brief,
        cwd: s.cwd,
        permissions: s.permissions,
        concise: s.conciseMode,
        model: s.model,
        skills: s.skills,
        resumeNativeId: parent?.nativeSessionId ?? null,
        context: ctx,
        attachments: s.attachments,
        lean: getSettings().leanContext,
      },
      {
        emit: (kind, text, data) => addEvent(sid, kind, text, data),
        setNativeId: (id) => update(sid, { nativeSessionId: id }),
        setModel: (model) => update(sid, { model }),
        setUsage: (usage) => update(sid, { usage }),
        setSummary: (summary) => update(sid, { summary: redact(summary).slice(0, 40_000) }),
        setCommand: (command) => update(sid, { command }),
        raw: (stream, line) => pushRaw(sid, stream, line),
      },
    );
  } catch (e) {
    return fail((e as Error).message);
  }
  state.handles.set(sid, handle);
  update(sid, { status: "running" });
  audit("session.start", `${sid} agent=${s.agentId} cwd=${s.cwd}`);
  const result = await handle.done;
  state.handles.delete(sid);
  const cancelled = result.error === "Stopped by you.";
  if (!result.ok && !cancelled && (await handOff(sid, result.error ?? ""))) {
    pump();
    return;
  }
  const netDrop = !result.ok && !cancelled && classifyFailure(result.error) === "network";
  // Usage limit and no other agent free: wait for the reset time the agent itself reported.
  const resetAt = !result.ok && !cancelled && classifyFailure(result.error) === "limit" ? parseReset(result.error) : null;
  if (netDrop) waitForNetwork(sid);
  update(sid, {
    status: result.ok ? "completed" : cancelled ? "cancelled" : "failed",
    error: result.ok ? null : result.error ?? "Failed.",
    endedAt: new Date().toISOString(),
    ...(netDrop ? { notice: "The network dropped. Nexus runs this step again as soon as the connection is back." } : {}),
    ...(resetAt ? { retryAt: new Date(resetAt).toISOString(), notice: `Runs again at ${new Date(resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}, when the usage limit resets.` } : {}),
  });
  addEvent(sid, result.ok ? "status" : "error", result.ok ? "Session finished." : result.error ?? "Failed.");
  if (!result.ok) cascadeBlocked(sid);
  pump();
}
