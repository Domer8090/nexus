import { connection } from "next/server";
import { bad } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { npmFindings, proofFor } from "@/runtime/proof";
import { getSession, listEvents } from "@/runtime/sessions";
import { diff } from "@/runtime/workspace";

async function load(id: string) {
  const s = getSession(id);
  if (!s) return null;
  const d = await diff(s.cwd, s.baseRef);
  return proofFor({ cwd: s.cwd, base: s.baseRef, patch: "error" in d ? "" : d.patch, truncated: "error" in d ? false : d.truncated, events: listEvents(id) });
}

export async function GET(_req: Request, ctx: RouteContext<"/api/sessions/[id]/proof">) {
  await connection();
  const p = await load((await ctx.params).id);
  return p ? Response.json(p) : bad("Session not found.", 404);
}

/** Looks the new packages up on npm. A POST because it contacts the registry, so it runs only on a click. */
export async function POST(_req: Request, ctx: RouteContext<"/api/sessions/[id]/proof">) {
  const { id } = await ctx.params;
  const p = await load(id);
  if (!p) return bad("Session not found.", 404);
  audit("proof.npm", `${id} ${p.newPackages.join(" ")}`);
  return Response.json({ items: await npmFindings(p.newPackages), checked: Math.min(20, p.newPackages.length) });
}
