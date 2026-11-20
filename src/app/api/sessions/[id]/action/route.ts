import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { cancel, getSession, listSessions, markAppliedFiles, markReview, reassign, retry, revise, setResetWait } from "@/runtime/sessions";
import { applyToProject, diff, getProject, removeWorktree } from "@/runtime/workspace";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("wait-reset"), wait: z.boolean() }),
  z.object({ action: z.literal("reassign"), agentId: z.string().min(1).max(64), model: z.string().max(120).nullable().optional() }),
  z.object({ action: z.literal("revise"), feedback: z.string().trim().min(1, "Say what to change.").max(8000) }),
  z.object({ action: z.literal("apply"), confirm: z.literal(true), files: z.array(z.string().min(1).max(1024)).max(2000).optional() }),
  z.object({ action: z.literal("discard"), confirm: z.literal(true) }),
]);

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/action">) {
  const { id } = await ctx.params;
  const s = getSession(id);
  if (!s) return bad("Session not found.", 404);
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid action.");
  const a = p.data;
  if (a.action === "cancel") {
    cancel(id);
    return Response.json({ ok: true });
  }
  if (a.action === "retry") {
    if (!["failed", "cancelled"].includes(s.status)) return bad("Only failed or stopped sessions can be retried.");
    return Response.json({ session: retry(id) });
  }
  if (a.action === "wait-reset") {
    const held = s.status === "queued" && !!s.retryAt;
    if (s.status !== "failed" && !held) return bad("Only a failed step, or one waiting for a limit reset, can change this.");
    try {
      return Response.json({ session: setResetWait(id, a.wait) });
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  if (a.action === "reassign") {
    try {
      return Response.json({ session: await reassign(id, a.agentId, a.model ?? null) });
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  if (a.action === "revise") {
    if (["running", "starting", "queued"].includes(s.status)) return bad("Wait for the session to finish first.");
    try {
      return Response.json({ session: revise(id, a.feedback) });
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  const project = getProject(s.projectId);
  if (!project) return bad("Project not found.");
  if (!s.worktreeBranch || !s.baseRef) return bad("This session edited the project folder directly, so there is nothing to apply or discard.");
  // Team steps share one worktree: applying or discarding it covers all of them.
  const sharing = listSessions({ workflowId: s.workflowId ?? undefined }).filter((x) => x.cwd === s.cwd && x.id !== s.id);
  if (sharing.some((x) => ["running", "starting", "queued"].includes(x.status))) return bad("Another step is still working in this worktree. Wait for it to finish.");
  if (a.action === "apply") {
    let only: string[] | undefined;
    let total = 0;
    if (a.files) {
      // Partial Apply: only paths that really are in this diff, minus ones already applied.
      const d = await diff(s.cwd, s.baseRef);
      if ("error" in d) return bad(d.error);
      total = d.files.length;
      const known = new Set(d.files.map((f) => f.path));
      const done = new Set(s.appliedFiles ?? []);
      only = a.files.filter((f) => known.has(f) && !done.has(f));
      if (!only.length) return bad("Those files are already applied or no longer changed.");
      if (!done.size && only.length === total) only = undefined; // every file: a normal Apply
    } else if (s.appliedFiles?.length) {
      const d = await diff(s.cwd, s.baseRef);
      if ("error" in d) return bad(d.error);
      only = d.files.map((f) => f.path).filter((f) => !s.appliedFiles!.includes(f));
      total = d.files.length;
    }
    const r = await applyToProject(s.cwd, s.baseRef, project.path, only);
    audit("session.apply", `${id} -> ${project.path} ${r.ok ? `files=${r.files}${only ? " (selected)" : ""}` : "failed"}`);
    if (!r.ok) return bad(r.error, 409, "conflict");
    const appliedNow = only ?? [];
    const allDone = !only || (s.appliedFiles?.length ?? 0) + appliedNow.length >= total;
    if (allDone) {
      markReview(id, "applied");
      for (const x of sharing) if (x.status === "completed") markReview(x.id, "applied");
    } else markAppliedFiles(id, appliedNow, total);
    return Response.json({ ok: true, files: r.files, partial: !allDone });
  }
  await removeWorktree(project.path, s.cwd, s.worktreeBranch);
  markReview(id, "discarded");
  for (const x of sharing) if (["completed", "failed", "cancelled"].includes(x.status)) markReview(x.id, "discarded");
  audit("session.discard", `${id} worktree removed`);
  return Response.json({ ok: true });
}
