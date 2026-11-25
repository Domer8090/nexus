import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { startHackathon, suggestIdeas } from "@/runtime/build";
import { resumeWorkflow, stopWorkflow } from "@/runtime/sessions";
import { getSettings, saveSettings } from "@/runtime/settings";
import type { Hackathon } from "@/lib/modes";

const text = (max: number) => z.string().trim().max(max);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ideas"), name: text(120), theme: text(500), rubric: text(6000) }),
  z.object({
    action: z.literal("start"),
    name: text(120).min(2, "Name the hackathon."),
    theme: text(500),
    rubric: text(6000).min(3, "Paste what it is judged on."),
    idea: text(4000).min(5, "Describe the idea."),
    endsAt: z.iso.datetime({ message: "Set when it ends." }),
    runCommands: z.boolean(),
  }),
  z.object({ action: z.literal("deadline"), endsAt: z.iso.datetime() }),
  z.object({ action: z.literal("stop") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("end"), next: z.enum(["beginner", "advanced"]).default("advanced") }),
]);

let starting = false;

export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid request.");
  const a = p.data;
  const cur = getSettings().hackathon;
  if (a.action === "ideas") {
    try {
      return Response.json({ ideas: await suggestIdeas(a) });
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  if (a.action === "stop" || a.action === "resume") {
    if (!cur?.workflowId || cur.endedAt) return bad("No hackathon is running.");
    try {
      if (a.action === "stop") stopWorkflow(cur.workflowId);
      else resumeWorkflow(cur.workflowId);
    } catch (e) {
      return bad((e as Error).message);
    }
    return Response.json({ ok: true });
  }
  if (a.action === "end") {
    if (!cur || cur.endedAt) return bad("No hackathon is running.");
    const settings = saveSettings({ mode: a.next, hackathon: { ...cur, endedAt: new Date().toISOString() } });
    audit("hackathon.end", cur.name);
    return Response.json({ settings });
  }
  // "start" and "deadline" carry a date.
  if (Date.parse(a.endsAt) <= Date.now()) return bad("The end time must be in the future.");
  if (a.action === "deadline") {
    if (!cur || cur.endedAt) return bad("No hackathon is running.");
    return Response.json({ settings: saveSettings({ hackathon: { ...cur, endsAt: a.endsAt } }) });
  }
  if (starting || (cur && !cur.endedAt)) return bad("A hackathon is already running.");
  starting = true;
  try {
    const h: Hackathon = { name: a.name, theme: a.theme, rubric: a.rubric, idea: a.idea, endsAt: a.endsAt, runCommands: a.runCommands, projectId: null, workflowId: null, endedAt: null, startedAt: new Date().toISOString() };
    const r = await startHackathon(h);
    audit("hackathon.start", `${h.name} ${r.workflow.id}`);
    const settings = saveSettings({ mode: "hackathon", hackathon: { ...h, projectId: r.project.id, workflowId: r.workflow.id } });
    return Response.json({ settings, skills: r.skills });
  } catch (e) {
    return bad((e as Error).message);
  } finally {
    starting = false;
  }
}
