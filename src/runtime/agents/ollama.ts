import { run, which } from "../proc";
import type { AgentAdapter } from "./types";
import { CONCISE_INSTRUCTIONS } from "./types";

/**
 * Ollama local runtime. Talks only to the local Ollama server on 127.0.0.1:11434
 * (the address in Ollama's README). No account, no provider API, nothing leaves the machine.
 * Nexus uses it for local brief refinement, planning and diff review. It does not edit files.
 */

export const OLLAMA_URL = "http://127.0.0.1:11434";

export async function ollamaModels(): Promise<string[] | null> {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const j = (await r.json()) as { models?: { name: string }[] };
    return (j.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}

/** Streams a chat completion from the local Ollama server. */
export async function* ollamaChat(model: string, system: string, prompt: string, signal: AbortSignal) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
  });
  if (!r.ok || !r.body) throw new Error(`Ollama returned ${r.status}. Is the model pulled?`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean; prompt_eval_count?: number; eval_count?: number; total_duration?: number; error?: string };
      if (j.error) throw new Error(j.error);
      yield j;
    }
  }
}

export const ollamaAdapter: AgentAdapter = {
  id: "ollama",
  meta: {
    id: "ollama",
    displayName: "Ollama",
    vendor: "Ollama",
    kind: "local-runtime",
    integration: "supported",
    integrationNote: "Local models for brief refinement, planning and review of diffs. Read-only: it never edits your project.",
    capabilities: ["headless", "streaming", "local-models", "usage"],
    nexusCapabilities: ["headless", "streaming", "local-models", "usage", "parallel"],
    installCommands: [{ label: "macOS / Linux", command: "curl -fsSL https://ollama.com/install.sh | sh" }],
    loginCommand: null,
    docsUrl: "https://github.com/ollama/ollama",
    license: "MIT",
    eligibility: "No account. Runs models on this machine. Pull a model first, e.g. `ollama pull llama3.1:8b`.",
  },

  async detect() {
    const bin = which("ollama");
    if (!bin) return { install: "not-installed", version: null, binaryPath: null, auth: "unavailable", authDetail: "Ollama is not installed.", accountFacts: [], models: [] };
    const v = await run("ollama", ["--version"], { timeoutMs: 8000 });
    const version = v.stdout.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
    const models = await ollamaModels();
    if (models === null) {
      return { install: "installed", version, binaryPath: bin, auth: "not-required", authDetail: "Installed, but the Ollama server is not responding on 127.0.0.1:11434. Start the Ollama app or run `ollama serve`.", accountFacts: [{ label: "Server", value: "Not running" }], models: [] };
    }
    return {
      install: "installed",
      version,
      binaryPath: bin,
      auth: "not-required",
      authDetail: "Local runtime, no sign-in needed.",
      accountFacts: [{ label: "Server", value: "Running on 127.0.0.1:11434" }, { label: "Models pulled", value: String(models.length) }],
      models,
    };
  },

  previewCommand(input) {
    return ["POST", `${OLLAMA_URL}/api/chat`, `model=${input.model ?? "(first pulled model)"}`];
  },

  launch(input, sink) {
    const ctrl = new AbortController();
    const done = (async () => {
      const models = await ollamaModels();
      if (!models) return { ok: false, error: "The Ollama server is not running on 127.0.0.1:11434." };
      const model = input.model && models.includes(input.model) ? input.model : models[0];
      if (!model) return { ok: false, error: "No Ollama models are pulled. Run `ollama pull llama3.1:8b`." };
      sink.setModel(model);
      sink.setCommand(["POST", `${OLLAMA_URL}/api/chat`, `model=${model}`]);
      sink.emit("status", `Local model ${model} on Ollama`);
      const system = [
        "You are a careful senior engineer working inside Nexus. You cannot read or edit files; work only from the text given.",
        CONCISE_INSTRUCTIONS[input.concise] ?? "",
      ].join("\n");
      const prompt = input.brief + (input.context ? `\n\n---\nContext:\n${input.context}` : "");
      let all = "";
      let buf = "";
      let last = Date.now();
      try {
        for await (const chunk of ollamaChat(model, system, prompt, ctrl.signal)) {
          const t = chunk.message?.content ?? "";
          all += t;
          buf += t;
          if (Date.now() - last > 120) {
            sink.emit("text", buf);
            buf = "";
            last = Date.now();
          }
          if (chunk.done) {
            if (buf) sink.emit("text", buf);
            sink.setUsage({
              inputTokens: chunk.prompt_eval_count,
              outputTokens: chunk.eval_count,
              durationMs: chunk.total_duration ? Math.round(chunk.total_duration / 1e6) : undefined,
              model,
              source: "Ollama /api/chat final chunk",
            });
          }
        }
        sink.setSummary(all.slice(0, 4000));
        return { ok: true };
      } catch (e) {
        if (ctrl.signal.aborted) return { ok: false, error: "Stopped by you." };
        return { ok: false, error: `Ollama error: ${(e as Error).message}` };
      }
    })();
    return { done, cancel: () => ctrl.abort() };
  },
};
