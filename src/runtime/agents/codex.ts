import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandPreview, killTree, onLines, run, spawnLong, which } from "../proc";
import { redact } from "../redact";
import type { AgentAdapter, LaunchInput } from "./types";
import { CONCISE_INSTRUCTIONS } from "./types";

/**
 * Codex CLI adapter. Uses only surfaces checked against `codex exec --help` (codex-cli 0.169)
 * and tested on this machine with a ChatGPT sign-in:
 *   codex login status                         sign-in state ("Logged in using ChatGPT")
 *   codex exec --json --sandbox <mode> -C <dir> <prompt>     JSONL events
 *   codex exec resume --json <thread_id> <prompt>            follow-up turn
 * Event types seen: thread.started, turn.started, item.started / item.completed
 * (agent_message, command_execution, file_change, error), turn.completed (usage), turn.failed, error.
 * Image generation is a Codex built-in tool (`codex features list`: image_generation, stable) that
 * runs under the user's ChatGPT plan. Nexus never passes an API key and strips OPENAI_API_KEY.
 */

/**
 * The models Codex itself lists for this account. Codex keeps them in ~/.codex/models_cache.json
 * (a model catalog, no credentials). Nexus shows only entries Codex marks visible and never guesses.
 */
export function codexModels(home = os.homedir()): { id: string; label: string; description: string }[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.env.CODEX_HOME?.trim() || path.join(home, ".codex"), "models_cache.json"), "utf8")) as {
      models?: { slug?: string; display_name?: string; description?: string; visibility?: string; priority?: number }[];
    };
    return (raw.models ?? [])
      .filter((m) => m.slug && m.visibility === "list")
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      .map((m) => ({ id: m.slug!, label: m.display_name || m.slug!, description: m.description ?? "" }));
  } catch {
    return [];
  }
}

function footer(input: LaunchInput) {
  const extra: string[] = [];
  const concise = CONCISE_INSTRUCTIONS[input.concise];
  if (concise) extra.push(concise);
  if (input.skills.length) extra.push(`Relevant installed skills for this task: ${input.skills.join(", ")}. Use them only where they apply.`);
  extra.push("You are running inside Nexus. Work only inside the current directory. Do not push, deploy, or rewrite git history.");
  return extra.join("\n");
}

export function buildCodexArgs(input: LaunchInput): string[] {
  const p = input.permissions;
  const prompt = `${input.brief}${input.context ? `\n\n---\nContext:\n${input.context}` : ""}\n\n---\n${footer(input)}`;
  const sandbox = p.editFiles ? "workspace-write" : "read-only";
  const args = input.resumeNativeId ? ["exec", "resume", "--json", "--skip-git-repo-check", "-c", `sandbox_mode="${sandbox}"`] : ["exec", "--json", "--skip-git-repo-check", "--sandbox", sandbox, "-C", input.cwd];
  if (p.editFiles && p.network) args.push("-c", "sandbox_workspace_write.network_access=true");
  if (input.model) args.push("-m", input.model);
  if (input.resumeNativeId) args.push(input.resumeNativeId);
  // --image takes several values, so it goes before the next flag, never right before the prompt.
  if (input.attachments?.length) args.splice(input.resumeNativeId ? 2 : 1, 0, "--image", ...input.attachments);
  args.push(prompt);
  return args;
}

function short(v: unknown, n = 160) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Strips the shell wrapper Codex reports, e.g. `/bin/zsh -lc 'ls'` becomes `ls`. */
function bareCommand(c: string) {
  const m = c.match(/^\/bin\/(?:ba|z)?sh -lc (['"])([\s\S]*)\1$/);
  return m ? m[2] : c;
}

export const codexAdapter: AgentAdapter = {
  id: "codex",
  meta: {
    id: "codex",
    displayName: "Codex CLI",
    vendor: "OpenAI",
    kind: "coding-cli",
    integration: "supported",
    integrationNote:
      "Runs `codex exec --json` sessions with your ChatGPT sign-in: streamed messages and commands, file edits, image generation, resume for revisions and token counts. Codex runs its shell inside its own sandbox (project folder only, no network unless you allow it); Nexus cannot switch that shell off.",
    capabilities: ["interactive", "headless", "streaming", "parallel", "edits-project", "mcp", "resume", "usage", "images"],
    nexusCapabilities: ["headless", "streaming", "parallel", "edits-project", "resume", "usage", "images"],
    installCommands: [
      { label: "npm", command: "npm install -g @openai/codex" },
      { label: "Homebrew", command: "brew install --cask codex" },
    ],
    loginCommand: { label: "Sign in with ChatGPT", command: "codex login", runnable: true },
    docsUrl: "https://github.com/openai/codex",
    license: "Apache-2.0",
    eligibility: "Sign in with ChatGPT per the Codex README. Usage counts against your ChatGPT plan. Nexus refuses a Codex sign-in that uses an API key.",
  },

  async detect() {
    const withModels = () => {
      const m = codexModels();
      return { models: m.map((x) => x.id), modelInfo: m };
    };
    const bin = which("codex");
    if (!bin) return { install: "not-installed", version: null, binaryPath: null, auth: "unavailable", authDetail: "Codex CLI is not installed.", accountFacts: [], models: [] };
    const v = await run("codex", ["--version"], { timeoutMs: 10_000 });
    const version = v.stdout.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
    const s = await run("codex", ["login", "status"], { timeoutMs: 15_000 });
    const out = `${s.stdout}\n${s.stderr}`;
    if (/logged in using chatgpt/i.test(out)) {
      return { install: "installed", version, binaryPath: bin, auth: "authenticated", authDetail: "Signed in with ChatGPT, as reported by `codex login status`.", accountFacts: [{ label: "Sign-in method", value: "ChatGPT account" }], ...withModels() };
    }
    if (/api key/i.test(out)) {
      return { install: "installed", version, binaryPath: bin, auth: "needs-sign-in", authDetail: "Codex is signed in with an API key. Nexus only uses ChatGPT sign-in: run `codex logout`, then `codex login`.", accountFacts: [{ label: "Sign-in method", value: "API key (not used by Nexus)" }], models: [] };
    }
    if (/not logged in/i.test(out)) return { install: "installed", version, binaryPath: bin, auth: "needs-sign-in", authDetail: "Not signed in. Run `codex login` and choose Sign in with ChatGPT.", accountFacts: [], models: [] };
    return { install: "installed", version, binaryPath: bin, auth: "unknown", authDetail: "Could not read sign-in state from `codex login status`.", accountFacts: [], models: [] };
  },

  previewCommand(input) {
    return ["codex", ...buildCodexArgs(input)];
  },

  launch(input, sink) {
    const args = buildCodexArgs(input);
    const shown = args.map((a, i) => (i === args.length - 1 ? "<brief>" : a));
    sink.setCommand(["codex", ...shown].map(redact));
    sink.emit("system", `Started: ${commandPreview("codex", shown)}`);
    if (input.permissions.editFiles && !input.permissions.runShell) sink.emit("system", "Codex runs shell commands inside its sandbox (this folder only). Nexus cannot switch its shell off.");
    const child = spawnLong("codex", args, input.cwd);
    let lastMessage = "";
    let failed: string | undefined;
    let completed = false;
    const usage = { input: 0, output: 0, cached: 0 };

    onLines(child.stdout!, (line) => {
      sink.raw?.("out", line);
      let o: { type?: string; thread_id?: string; message?: string; error?: { message?: string }; usage?: Record<string, number>; item?: Record<string, unknown> };
      try {
        o = JSON.parse(line);
      } catch {
        return;
      }
      if (o.type === "thread.started" && o.thread_id) {
        sink.setNativeId(o.thread_id);
        sink.emit("status", "Codex session ready");
      } else if (o.type === "item.started" && o.item?.type === "command_execution") {
        sink.emit("tool", `Shell: ${short(bareCommand(String(o.item.command ?? "")), 160)}`, { tool: "shell" });
      } else if (o.type === "item.completed" && o.item) {
        const it = o.item;
        if (it.type === "agent_message" && typeof it.text === "string") {
          lastMessage = it.text;
          sink.emit("text", `${it.text}\n\n`);
        } else if (it.type === "command_execution" && typeof it.exit_code === "number" && it.exit_code !== 0) {
          sink.emit("tool-result", `Command exited ${it.exit_code}: ${short(String(it.aggregated_output ?? ""), 300)}`, { error: true });
        } else if (it.type === "file_change" && Array.isArray(it.changes)) {
          for (const c of it.changes as { path?: string; kind?: string }[]) if (c.path) sink.emit("file", c.path, { tool: c.kind ?? "edit" });
        } else if (it.type === "error" && typeof it.message === "string") {
          sink.emit("stderr", redact(it.message).slice(0, 500));
        } else if (typeof it.type === "string" && /image/i.test(it.type)) {
          sink.emit("tool", "Image generation", { tool: "image_generation" });
        }
      } else if (o.type === "turn.completed") {
        completed = true;
        const u = o.usage ?? {};
        usage.input += u.input_tokens ?? 0;
        usage.output += (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0);
        usage.cached += u.cached_input_tokens ?? 0;
        sink.setUsage({ inputTokens: usage.input, outputTokens: usage.output, cacheReadTokens: usage.cached, model: input.model ?? undefined, source: "Codex `exec --json` turn.completed event" });
      } else if (o.type === "turn.failed") {
        failed = o.error?.message ?? "Codex turn failed.";
      } else if (o.type === "error" && o.message) {
        failed = o.message;
      }
    });

    onLines(child.stderr!, (line) => {
      sink.raw?.("err", line);
      if (/^Reading additional input from stdin/.test(line)) return;
      sink.emit("stderr", redact(line).slice(0, 500));
    });

    let cancelled = false;
    const done = new Promise<{ ok: boolean; error?: string }>((resolve) => {
      child.on("error", (e) => resolve({ ok: false, error: `Could not start Codex: ${e.message}` }));
      child.on("close", (code, signal) => {
        if (lastMessage) sink.setSummary(lastMessage);
        if (cancelled) return resolve({ ok: false, error: "Stopped by you." });
        if (failed) return resolve({ ok: false, error: short(redact(failed), 400) });
        if (code === 0 && completed) return resolve({ ok: true });
        resolve({ ok: false, error: signal ? `Codex was stopped (${signal}).` : `Codex exited with code ${code}. Check that you are signed in with ChatGPT.` });
      });
    });

    return {
      pid: child.pid,
      done,
      cancel() {
        cancelled = true;
        killTree(child, "SIGTERM");
        setTimeout(() => killTree(child, "SIGKILL"), 4000);
      },
    };
  },
};
