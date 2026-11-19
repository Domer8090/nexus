import { connection } from "next/server";
import { bad } from "@/lib/api";
import { folderVersion, previewUrl, viewInfo } from "@/runtime/preview-server";
import { getSession } from "@/runtime/sessions";
import { getProject } from "@/runtime/workspace";

/** How to view a session's (or project's) result: a preview URL for static pages, or the dev command. */
export async function GET(req: Request) {
  await connection();
  const u = new URL(req.url);
  const sid = u.searchParams.get("session");
  const pid = u.searchParams.get("project");
  const s = sid ? getSession(sid) : null;
  const proj = pid ? getProject(pid) : null;
  const dir = s?.cwd ?? proj?.path;
  if (!dir) return bad("Not found.", 404);
  const info = viewInfo(dir);
  let url: string | null = null;
  try {
    if (info.entry) url = await previewUrl(s ? "s" : "p", (s?.id ?? proj?.id)!, info.entry);
  } catch (e) {
    return Response.json({ ...info, url: null, path: dir, error: (e as Error).message });
  }
  return Response.json({ ...info, url, path: dir, version: folderVersion(dir) });
}
