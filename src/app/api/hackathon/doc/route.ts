import fs from "node:fs";
import path from "node:path";
import { connection } from "next/server";
import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { HACK_DOCS } from "@/lib/hackathon-docs";
import { getSettings } from "@/runtime/settings";
import { getProject } from "@/runtime/workspace";

/** The documents the hackathon pipeline writes, from fixed paths inside its own project only. */
export async function GET() {
  await connection();
  const h = getSettings().hackathon;
  const project = h?.projectId ? getProject(h.projectId) : null;
  if (!project) return bad("No hackathon project.", 404);
  const root = fs.realpathSync(project.path);
  const docs: Record<string, string | null> = {};
  for (const [id, d] of Object.entries(HACK_DOCS)) {
    try {
      const real = fs.realpathSync(path.join(root, d.file));
      docs[id] = real.startsWith(root + path.sep) ? fs.readFileSync(real, "utf8").slice(0, 60_000) : null;
    } catch {
      docs[id] = null;
    }
  }
  return Response.json({ docs });
}

const schema = z.object({ doc: z.enum(Object.keys(HACK_DOCS) as [keyof typeof HACK_DOCS]), was: z.string().max(60_000), text: z.string().max(60_000) });

/** Saves the person's edit, unless an agent changed the document since they opened it. */
export async function PUT(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad("That document is too long to save here.");
  const h = getSettings().hackathon;
  const project = h?.projectId ? getProject(h.projectId) : null;
  if (!project) return bad("No hackathon project.", 404);
  const root = fs.realpathSync(project.path);
  try {
    const real = fs.realpathSync(path.join(root, HACK_DOCS[p.data.doc].file));
    if (!real.startsWith(root + path.sep)) return bad("That file is outside the project.");
    const cur = fs.readFileSync(real, "utf8");
    if (cur.length > 60_000) return bad("That document is too long to edit here. Open it in Finder.");
    if (cur !== p.data.was) return bad("An agent changed this document while you were editing. Copy your text, cancel, and edit again.", 409);
    fs.writeFileSync(real, p.data.text);
  } catch {
    return bad("That document isn't there.", 404);
  }
  audit("hackathon.doc", p.data.doc);
  return Response.json({ ok: true });
}
