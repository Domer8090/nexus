import { connection } from "next/server";
import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { saveImages } from "@/runtime/ask";
import { getSession, getWorkflow, listSessions, resumeWorkflow, say, userMessages } from "@/runtime/sessions";
import type { Session } from "@/lib/types";

const TARGET = { workflow: z.string().regex(/^wf_[a-z0-9]+$/i).optional(), session: z.string().regex(/^ses_[a-z0-9]+$/i).optional() };

/** Who a message to a whole run goes to: the editor working now, else the next one, else the last. */
function pick(all: Session[]): Session | undefined {
  const ed = all.filter((s) => s.permissions.editFiles && s.role !== "assets").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const is = (...st: string[]) => (s: Session) => st.includes(s.status);
  return ed.find(is("running", "starting")) ?? ed.find(is("cancelled", "failed")) ?? ed.find(is("queued")) ?? ed.filter((s) => s.startedAt && is("completed", "applied")(s)).sort((a, b) => b.startedAt!.localeCompare(a.startedAt!))[0];
}

export async function GET(req: Request) {
  await connection();
  const id = new URL(req.url).searchParams.get("workflow") ?? "";
  if (!getWorkflow(id)) return bad("Run not found.", 404);
  return Response.json({ messages: userMessages(id) });
}

const schema = z.object({ ...TARGET, text: z.string().trim().min(1, "Write what should change.").max(12_000), images: z.array(z.string().max(12_000_000)).max(6).default([]), now: z.boolean().default(true) });

/** Sends the person's words, images and picked elements to the agent, at any moment of a run. */
export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid request.");
  const d = p.data;
  const s = d.session ? getSession(d.session) : d.workflow ? pick(listSessions({ workflowId: d.workflow })) : null;
  if (!s) return bad("There is no step that can take this.");
  try {
    const r = say(s.id, d.text, saveImages(d.images), d.now);
    if (["cancelled", "failed"].includes(s.status) && s.workflowId) resumeWorkflow(s.workflowId);
    audit("talk", `${s.id} images=${d.images.length} now=${d.now}`);
    return Response.json({ session: r });
  } catch (e) {
    return bad((e as Error).message);
  }
}
