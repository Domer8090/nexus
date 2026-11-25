import { connection } from "next/server";
import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { backboardReady } from "@/runtime/backboard";
import { shareText, shareablePatch } from "@/runtime/explain";
import { addReply, buildPacket, getHelp, saveHelp } from "@/runtime/help";
import { localModels } from "@/runtime/intake";
import { proofFor } from "@/runtime/proof";
import { getSession, listEvents } from "@/runtime/sessions";
import { diff, getProject } from "@/runtime/workspace";

export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[id]/help">) {
  await connection();
  const { id } = await ctx.params;
  if (!getSession(id)) return bad("Session not found.", 404);
  const local = !!(await localModels())?.some((m) => !/embed/i.test(m.name));
  return Response.json({ help: getHelp(id), engines: { backboard: backboardReady(), local } });
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("packet"), ask: z.string().trim().min(1, "Say what you want help with.").max(600) }),
  z.object({ action: z.literal("reply"), text: z.string().min(2).max(120_000) }),
]);

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/help">) {
  const { id } = await ctx.params;
  const s = getSession(id);
  if (!s) return bad("Session not found.", 404);
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid request.");
  if (p.data.action === "reply") {
    try {
      const help = addReply(id, p.data.text);
      audit("help.reply", id);
      return Response.json({ help });
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  const d = await diff(s.cwd, s.baseRef);
  if ("error" in d) return bad(d.error);
  if (!d.files.length) return bad("There are no changes to share.");
  if (d.truncated || d.files.length > 60) return bad("This change is too big for one help file. Apply part of it first, then ask about the rest.");
  const h = saveHelp(id, { ask: p.data.ask, at: new Date().toISOString() });
  const proof = await proofFor({ cwd: s.cwd, base: s.baseRef, patch: d.patch, truncated: d.truncated, events: listEvents(id) });
  const patches = shareablePatch(d.patch);
  const html = buildPacket({
    id: h.id,
    project: getProject(s.projectId)?.name ?? "a project",
    task: shareText(s.brief).slice(0, 1500),
    ask: shareText(p.data.ask),
    explanation: h.explanation,
    proof: { items: proof.items.map((i) => ({ ...i, text: shareText(i.text) })) },
    files: d.files.map((f) => ({ path: f.path, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.binary ? "(binary file)" : (patches.get(f.path) ?? "(no text changes)") })),
  });
  audit("help.packet", `${id} files=${d.files.length}`);
  return Response.json({ help: h, html });
}
