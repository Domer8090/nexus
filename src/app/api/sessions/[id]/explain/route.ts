import { z } from "zod";
import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { explain } from "@/runtime/explain";
import { saveHelp } from "@/runtime/help";
import { getSession } from "@/runtime/sessions";
import { diff } from "@/runtime/workspace";

const schema = z.object({ reader: z.enum(["beginner", "teammate", "designer"]), engine: z.enum(["backboard", "local"]) });

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/explain">) {
  const { id } = await ctx.params;
  const s = getSession(id);
  if (!s) return bad("Session not found.", 404);
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad("Pick a reader and a model.");
  const d = await diff(s.cwd, s.baseRef);
  if ("error" in d) return bad(d.error);
  if (!d.files.length) return bad("There are no changes to explain.");
  audit("explain", `${id} engine=${p.data.engine}`);
  try {
    const explanation = await explain(s.brief, d.patch, p.data.reader, p.data.engine);
    saveHelp(id, { explanation });
    return Response.json({ explanation });
  } catch (e) {
    return bad((e as Error).message, 502, "explain");
  }
}
