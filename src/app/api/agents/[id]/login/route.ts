import { bad } from "@/lib/api";
import { audit } from "@/runtime/audit";
import { detectAll } from "@/runtime/agents/registry";
import { run } from "@/runtime/proc";

/**
 * Opens the agent's own sign-in command in Terminal (macOS). The command string comes
 * from the registry, never from the request. Nexus never sees the credentials.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/agents/[id]/login">) {
  const { id } = await ctx.params;
  const agent = (await detectAll()).find((a) => a.id === id);
  if (!agent?.loginCommand?.runnable) return bad("This agent has no sign-in command Nexus can open.");
  if (agent.install !== "installed") return bad(`${agent.displayName} is not installed.`);
  if (process.platform !== "darwin") return bad(`Run this in your terminal: ${agent.loginCommand.command}`, 400, "manual");
  const cmd = agent.loginCommand.command.replace(/["\\]/g, "");
  const r = await run("osascript", ["-e", `tell application "Terminal" to do script "${cmd}"`, "-e", 'tell application "Terminal" to activate'], { timeoutMs: 10_000 });
  audit("agent.login.open", `${id}: ${cmd}`);
  if (r.code !== 0) return bad(`Could not open Terminal. Run this yourself: ${agent.loginCommand.command}`, 500, "terminal");
  return Response.json({ ok: true, command: agent.loginCommand.command });
}
