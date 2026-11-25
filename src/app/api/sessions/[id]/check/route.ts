import { bad, body } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { run } from "@/runtime/proc";
import { redact } from "@/runtime/redact";
import { addEvent, getSession } from "@/runtime/sessions";
import { projectScripts } from "@/runtime/workspace";

/** Runs one of the project's own package.json check scripts in the session's folder, after the user approves it. */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/check">) {
  const { id } = await ctx.params;
  const s = getSession(id);
  if (!s) return bad("Session not found.", 404);
  const b = await body<{ script?: string; confirm?: boolean }>(req);
  if (!b?.confirm) return bad("Approve the command first.");
  const scripts = projectScripts(s.cwd);
  if (!b.script || !scripts.includes(b.script)) return bad("Pick one of the project's check scripts.");
  audit("session.check", `${id} npm run ${b.script} in ${s.cwd}`);
  const started = Date.now();
  const r = await run("npm", ["run", b.script, "--silent"], { cwd: s.cwd, timeoutMs: 300_000 });
  addEvent(id, "system", `Check npm run ${b.script} ${r.code === 0 ? "passed" : "failed"}`);
  return Response.json({ ok: r.code === 0, code: r.code, timedOut: r.timedOut, durationMs: Date.now() - started, output: redact((r.stdout + "\n" + r.stderr).trim()).slice(-12_000), command: `npm run ${b.script}` });
}
