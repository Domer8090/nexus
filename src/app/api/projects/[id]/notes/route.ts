import { connection } from "next/server";
import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { NOTES_MAX, addNote, getNotes, setNotes } from "@/runtime/notes";
import { getProject } from "@/runtime/workspace";

export async function GET(_req: Request, ctx: RouteContext<"/api/projects/[id]/notes">) {
  await connection();
  const { id } = await ctx.params;
  if (!getProject(id)) return bad("Project not found.", 404);
  return Response.json(getNotes(id));
}

const schema = z.union([z.object({ text: z.string().max(NOTES_MAX, `Notes can be up to ${NOTES_MAX} characters.`) }), z.object({ add: z.string().trim().min(1).max(600) })]);

export async function PUT(req: Request, ctx: RouteContext<"/api/projects/[id]/notes">) {
  const { id } = await ctx.params;
  if (!getProject(id)) return bad("Project not found.", 404);
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad(p.error.issues[0]?.message ?? "Invalid notes.");
  const n = "text" in p.data ? setNotes(id, p.data.text) : addNote(id, p.data.add);
  audit("project.notes", `${id} ${n.text.length} chars`);
  return Response.json(n);
}
