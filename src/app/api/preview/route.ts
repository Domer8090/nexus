import { z } from "zod";
import { bad, body } from "@/lib/api";
import { getAdapter } from "@/runtime/agents/registry";
import { commandPreview } from "@/runtime/proc";
import { CONCISE_MODES } from "@/lib/types";

const schema = z.object({
  agentId: z.string(),
  brief: z.string().max(40000),
  model: z.string().nullable().optional(),
  concise: z.enum(CONCISE_MODES),
  skills: z.array(z.string()).max(20),
  permissions: z.object({ editFiles: z.boolean(), runShell: z.boolean(), network: z.boolean(), isolate: z.boolean() }),
});

/** Shows the exact command a session will run, before the user approves it. */
export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad("Invalid request.");
  const a = getAdapter(p.data.agentId);
  if (!a?.previewCommand) return bad("No preview for this agent.");
  const argv = a.previewCommand({ ...p.data, sessionId: "preview", cwd: ".", brief: "<task brief>", model: p.data.model ?? null });
  return Response.json({ argv, text: argv[0] === "POST" ? argv.join(" ") : commandPreview(argv[0], argv.slice(1)) });
}
