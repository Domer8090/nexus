import { redact } from "./redact";

/**
 * Backboard (backboard.io), an optional hosted model. Off unless BACKBOARD_API_KEY is in the
 * environment (.env.local), and called only from a button that says so. The key is never stored in
 * SQLite, sent to the browser, logged, or passed to an agent.
 */

const URL_ = "https://app.backboard.io/api/threads/messages";

export const backboardReady = () => !!process.env.BACKBOARD_API_KEY?.trim();

export async function backboardChat(system: string, prompt: string): Promise<{ text: string; model: string }> {
  const key = process.env.BACKBOARD_API_KEY?.trim();
  if (!key) throw new Error("Add BACKBOARD_API_KEY to .env.local and restart Nexus to use Backboard.");
  // Optional override, written provider/model. Without it Backboard uses its own default.
  const m = process.env.BACKBOARD_MODEL?.trim().match(/^([^/]+)\/(.+)$/);
  let r: Response;
  try {
    r = await fetch(URL_, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-Key": key },
      body: JSON.stringify({ content: prompt, system_prompt: system, stream: false, memory: "off", json_output: true, ...(m ? { llm_provider: m[1], model_name: m[2] } : {}) }),
      signal: AbortSignal.timeout(90_000),
      redirect: "error",
    });
  } catch {
    throw new Error("Couldn't reach Backboard. Check your connection and try again.");
  }
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new Error("Backboard refused the API key. Check BACKBOARD_API_KEY in .env.local.");
    if (r.status === 402) throw new Error("Backboard says this account has no credits left.");
    if (r.status === 429) throw new Error("Backboard is rate limiting this key. Wait a minute and try again.");
    throw new Error(`Backboard returned ${r.status}. ${redact((await r.text()).split(key).join("[redacted]")).slice(0, 160)}`);
  }
  const j = (await r.json()) as { content?: unknown; status?: string; model_provider?: string; model_name?: string };
  if (typeof j.content !== "string" || !j.content.trim()) throw new Error("Backboard sent an empty answer.");
  return { text: j.content, model: [j.model_provider, j.model_name].filter(Boolean).join("/") || "its default model" };
}
