import { connection } from "next/server";
import { z } from "zod";
import { bad, body } from "@/lib/api";
import { listCheckpoints, restoreCheckpoint, takeCheckpoint } from "@/runtime/checkpoints";
import { listSessions } from "@/runtime/sessions";

/** The folder a run edits: its newest started editing step. */
function folder(id: string) {
  const all = listSessions({ workflowId: id });
  const s = all.filter((x) => x.permissions.editFiles && x.startedAt).sort((a, b) => b.startedAt!.localeCompare(a.startedAt!))[0];
  return { cwd: s?.cwd ?? null, live: all.some((x) => ["running", "starting"].includes(x.status)), all };
}

export async function GET(req: Request) {
  await connection();
  const id = new URL(req.url).searchParams.get("workflow") ?? "";
  const f = folder(id);
  return Response.json({ checkpoints: f.cwd ? await listCheckpoints(f.cwd, id) : [] });
}

const schema = z.object({ workflow: z.string().regex(/^wf_[a-z0-9]+$/i), action: z.enum(["save", "restore"]), id: z.string().max(40).optional(), label: z.string().trim().max(80).optional(), confirm: z.literal(true) });

export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad("Invalid request.");
  const f = folder(p.data.workflow);
  if (!f.cwd) return bad("Nothing has been built yet.");
  try {
    if (p.data.action === "save") {
      if (!(await takeCheckpoint(f.cwd, p.data.label || "Saved by you", p.data.workflow))) return bad("Checkpoints need a git repository.");
    } else {
      // Any step in any run using this folder would overwrite, or be overwritten by, the restore.
      const busy = listSessions({ limit: 500 }).some((s) => s.cwd === f.cwd && ["running", "starting"].includes(s.status));
      if (busy || f.live) return bad("Stop the agents before going back.");
      await restoreCheckpoint(f.cwd, p.data.workflow, p.data.id ?? "");
    }
  } catch (e) {
    return bad((e as Error).message);
  }
  return Response.json({ checkpoints: await listCheckpoints(f.cwd, p.data.workflow) });
}
