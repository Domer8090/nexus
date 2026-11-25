import { connection } from "next/server";
import { z } from "zod";
import type { AskState } from "@/lib/ask-types";
import { bad, body } from "@/lib/api";
import { generating, more, seedAsk } from "@/runtime/ask-more";
import { answer, answersSince, answersText, getAsk } from "@/runtime/ask-store";
import { getWorkflow, listSessions, revise } from "@/runtime/sessions";

const ID = z.string().regex(/^(wf_[a-z0-9]+|draft-hackathon)$/i);

/** Where late answers can go: the run's last finished editor, when no editing step is still to come. */
function applyTarget(id: string) {
  if (!id.startsWith("wf_")) return null;
  const all = listSessions({ workflowId: id });
  if (all.some((s) => ["running", "starting", "queued"].includes(s.status))) return null;
  const editors = all.filter((s) => s.permissions.editFiles && s.startedAt).sort((a, b) => b.startedAt!.localeCompare(a.startedAt!));
  const s = editors[0];
  if (!s || s.status !== "completed" || !s.nativeSessionId) return null;
  const late = answersSince(id, s.startedAt!);
  return late.length ? { s, late } : null;
}

function view(id: string): AskState {
  return { questions: getAsk(id).questions, generating: generating(id), canApply: !!applyTarget(id) };
}

export async function GET(req: Request) {
  await connection();
  const id = ID.safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return bad("Invalid request.");
  return Response.json(view(id.data));
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("seed"), id: ID, goal: z.string().trim().max(4000).default(""), kind: z.enum(["hackathon", "run"]) }),
  z.object({ action: z.literal("answer"), id: ID, question: z.string().max(40), text: z.string().trim().min(1).max(600).nullable() }),
  z.object({ action: z.literal("apply"), id: ID }),
]);

export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid request.");
  const a = p.data;
  if (a.action === "seed") {
    const w = a.id.startsWith("wf_") ? getWorkflow(a.id) : null;
    if (a.id.startsWith("wf_") && !w) return bad("Run not found.", 404);
    const live = !w || listSessions({ workflowId: a.id }).some((s) => ["running", "starting", "queued"].includes(s.status));
    // Old finished runs are not asked about; a run in progress is, once.
    if (live && (!w || !getAsk(a.id).goal)) seedAsk(a.id, w ? w.brief.slice(0, 4000) : a.goal, a.kind);
  } else if (a.action === "answer") {
    if (!answer(a.id, a.question, a.text)) return bad("That question is gone.", 404);
    void more(a.id);
  } else {
    const t = applyTarget(a.id);
    if (!t) return bad("There is nothing to apply right now.");
    revise(t.s.id, `The user answered these questions after you finished. Change the project to match, keep everything else working:\n${answersText(t.late)}`);
  }
  return Response.json(view(a.id));
}
