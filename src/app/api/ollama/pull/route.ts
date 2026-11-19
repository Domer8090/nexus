import { z } from "zod";
import { bad, body } from "@/lib/api";
import { OLLAMA_URL } from "@/runtime/agents/ollama";
import { audit } from "@/runtime/audit";
import { LIGHT_MODELS } from "@/runtime/intake";

const schema = z.object({ model: z.enum(LIGHT_MODELS.map((m) => m.name) as [string, ...string[]]), confirm: z.literal(true) });

/** Downloads a light model through the local Ollama server, after the user approved name and size. Streams progress. */
export async function POST(req: Request) {
  const p = schema.safeParse(await body(req));
  if (!p.success) return bad("Approve the download first.");
  let r: Response;
  try {
    r = await fetch(`${OLLAMA_URL}/api/pull`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: p.data.model, stream: true }) });
  } catch {
    return bad("Ollama is not running on 127.0.0.1:11434. Start the Ollama app first.", 503);
  }
  if (!r.ok || !r.body) return bad(`Ollama returned ${r.status}.`, 502);
  audit("ollama.pull", p.data.model);
  return new Response(r.body, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}
