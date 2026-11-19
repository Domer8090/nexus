import { commandPreview, killTree, onLines, run, spawnLong, which } from "../proc";
import { redact } from "../redact";
import type { AgentAdapter, LaunchInput } from "./types";
import { CONCISE_INSTRUCTIONS } from "./types";

/**
 * Claude Code adapter. Uses only documented CLI surfaces (checked against `claude --help`, v2.1.x):
 *   claude auth status            JSON auth state
 *   claude auth login             official sign-in (run by the user in a terminal)
 *   claude -p ... --output-format stream-json --verbose --include-partial-messages
 *   --permission-mode plan|acceptEdits, --permission-prompts none,
 *   --allowedTools / --disallowedTools, --resume <id>, --model, --append-system-prompt
 */

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function buildArgs(input: LaunchInput): string[] {
  const p = input.permissions;
  const args = ["-p", input.brief + (input.context ? `\n\n---\nContext:\n${input.context}` : "")];
  args.push("--output-format", "stream-json", "--verbose", "--include-partial-messages");
  args.push("--permission-mode", p.editFiles ? "acceptEdits" : "plan");
  args.push("--permission-prompts", "none");
  const disallowed: string[] = [];
  if (!p.runShell) disallowed.push("Bash");
  if (!p.network) disallowed.push("WebFetch", "WebSearch");
  if (disallowed.length) args.push("--disallowedTools", ...disallowed);
  if (p.runShell) args.push("--allowedTools", "Bash");
  if (input.model) args.push("--model", input.model);
  const extra: string[] = [];
  const concise = CONCISE_INSTRUCTIONS[input.concise];
  if (concise) extra.push(concise);
  if (input.skills.length) extra.push(`Relevant installed skills for this task: ${input.skills.join(", ")}. Use them only where they apply.`);
  extra.push("You are running inside Nexus. Work only inside the current directory. Do not push, deploy, or rewrite git history.");
  args.push("--append-system-prompt", extra.join("\n"));
  if (input.resumeNativeId) args.push("--resume", input.resumeNativeId);
  args.push("-n", `nexus-${input.sessionId}`);
  return args;
}

function short(v: unknown, n = 160) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export const claudeAdapter: AgentAdapter = {
  id: "claude-code",
  meta: {
    id: "claude-code",
    displayName: "Claude Code",
    vendor: "Anthropic",
    kind: "coding-cli",
    integration: "supported",
    integrationNote: "Runs headless sessions with streamed events, file edits, resume for revisions, and usage reported by the CLI.",
    capabilities: ["interactive", "headless", "streaming", "parallel", "edits-project", "skills", "mcp", "resume", "usage"],
    nexusCapabilities: ["headless", "streaming", "parallel", "edits-project", "skills", "mcp", "resume", "usage"],
    installCommands: [
      { label: "Native installer (macOS, Linux, WSL)", command: "curl -fsSL https://claude.ai/install.sh | bash" },
      { label: "npm (Node.js 22+)", command: "npm install -g @anthropic-ai/claude-code@latest" },
      { label: "Homebrew", command: "brew install --cask claude-code" },
    ],
    loginCommand: { label: "Sign in with your Claude account", command: "claude auth login", runnable: true },
    docsUrl: "https://code.claude.com/docs/en/getting-started",
    license: "Proprietary (Anthropic Commercial Terms)",
    eligibility: "Per Anthropic's docs: Claude Pro, Max, Ultra, Team, Enterprise or Console accounts. The free claude.ai plan has no Claude Code access. Nexus strips ANTHROPIC_API_KEY so your account sign-in is used.",
  },

  async detect() {
    const bin = which("claude");
    if (!bin) return { install: "not-installed", version: null, binaryPath: null, auth: "unavailable", authDetail: "Claude Code is not installed.", accountFacts: [], models: [] };
    const v = await run("claude", ["--version"], { timeoutMs: 10_000 });
    const version = v.stdout.trim().split(/\s/)[0] || null;
    const s = await run("claude", ["auth", "status"], { timeoutMs: 15_000 });
    let auth: "authenticated" | "needs-sign-in" | "unknown" = "unknown";
    let authDetail = "Could not read sign-in state from `claude auth status`.";
    const facts: { label: string; value: string }[] = [];
    try {
      const j = JSON.parse(s.stdout) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string; apiProvider?: string; loginExpiresAt?: string };
      const expired = j.loginExpiresAt && Date.parse(j.loginExpiresAt) < Date.now();
      if (j.loggedIn && expired) {
        auth = "needs-sign-in";
        authDetail = `Your sign-in expired on ${new Date(j.loginExpiresAt!).toLocaleString()}. Run \`claude auth login\` in a terminal.`;
      } else if (j.loggedIn) {
        auth = "authenticated";
        authDetail = "Signed in, as reported by `claude auth status`.";
        if (j.authMethod) facts.push({ label: "Sign-in method", value: j.authMethod === "claude.ai" ? "Claude account (claude.ai)" : j.authMethod });
        if (j.subscriptionType) facts.push({ label: "Plan", value: j.subscriptionType[0].toUpperCase() + j.subscriptionType.slice(1) });
        if (j.apiProvider) facts.push({ label: "Provider", value: j.apiProvider === "firstParty" ? "Anthropic" : j.apiProvider });
      } else {
        auth = "needs-sign-in";
        authDetail = "Not signed in. Run `claude auth login` in a terminal.";
      }
    } catch {}
    return {
      install: "installed",
      version,
      binaryPath: bin,
      auth,
      authDetail,
      accountFacts: facts,
      models: ["opus", "sonnet", "haiku"],
    };
  },

  previewCommand(input) {
    return ["claude", ...buildArgs(input)];
  },

  launch(input, sink) {
    const args = buildArgs(input);
    sink.setCommand(["claude", ...args.map((a, i) => (args[i - 1] === "-p" || args[i - 1] === "--append-system-prompt" ? short(a, 80) : a))].map(redact));
    sink.emit("system", `Started: ${commandPreview("claude", args.map((a, i) => (args[i - 1] === "-p" || args[i - 1] === "--append-system-prompt" ? "<brief>" : a)))}`);
    const child = spawnLong("claude", args, input.cwd);
    let textBuf = "";
    let flushTimer: NodeJS.Timeout | null = null;
    const flush = () => {
      flushTimer = null;
      if (textBuf) {
        sink.emit("text", textBuf);
        textBuf = "";
      }
    };
    let resultError: string | undefined;
    let gotResult = false;
    const quota: { window: string; utilization: number; resetsAt?: string; status?: string }[] = [];

    onLines(child.stdout!, (line) => {
      sink.raw?.("out", line);
      let o: Record<string, unknown>;
      try {
        o = JSON.parse(line);
      } catch {
        return;
      }
      const type = o.type as string;
      if (type === "system" && o.subtype === "init") {
        if (typeof o.session_id === "string") sink.setNativeId(o.session_id);
        if (typeof o.model === "string") sink.setModel(o.model);
        sink.emit("status", `Session ready, model ${o.model ?? "unknown"}, permission mode ${o.permissionMode ?? "unknown"}`);
      } else if (type === "system" && o.subtype === "task_summary" && typeof o.detail === "string") {
        sink.emit("status", o.detail);
      } else if (type === "stream_event") {
        const ev = o.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          textBuf += ev.delta.text;
          if (!flushTimer) flushTimer = setTimeout(flush, 120);
        }
      } else if (type === "assistant") {
        flush();
        const content = ((o.message as { content?: unknown[] })?.content ?? []) as { type: string; name?: string; input?: Record<string, unknown> }[];
        for (const b of content) {
          if (b.type !== "tool_use" || !b.name) continue;
          const inp = b.input ?? {};
          const target = (inp.file_path ?? inp.path ?? inp.notebook_path ?? inp.command ?? inp.pattern ?? inp.url ?? inp.description) as string | undefined;
          sink.emit("tool", `${b.name}${target ? `: ${short(target, 140)}` : ""}`, { tool: b.name });
          if (EDIT_TOOLS.has(b.name) && typeof (inp.file_path ?? inp.notebook_path) === "string") {
            sink.emit("file", String(inp.file_path ?? inp.notebook_path), { tool: b.name });
          }
        }
      } else if (type === "user") {
        const content = ((o.message as { content?: unknown[] })?.content ?? []) as { type: string; is_error?: boolean; content?: unknown }[];
        for (const b of content) {
          if (b.type === "tool_result" && b.is_error) sink.emit("tool-result", `Tool error: ${short(b.content, 300)}`, { error: true });
        }
      } else if (type === "rate_limit_event") {
        const info = o.rate_limit_info as { unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number; status?: string }> } | undefined;
        quota.length = 0;
        for (const [w, v] of Object.entries(info?.unifiedWindows ?? {})) {
          if (typeof v.utilization === "number") {
            quota.push({ window: w.replace(/_/g, "-"), utilization: v.utilization, resetsAt: v.resetsAt ? new Date(v.resetsAt * 1000).toISOString() : undefined, status: v.status });
          }
        }
      } else if (type === "result") {
        flush();
        gotResult = true;
        const u = (o.usage ?? {}) as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
        const mu = Object.values((o.modelUsage ?? {}) as Record<string, { contextWindow?: number }>)[0];
        const model = Object.keys((o.modelUsage ?? {}) as object)[0];
        sink.setUsage({
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          cacheReadTokens: u.cache_read_input_tokens,
          cacheWriteTokens: u.cache_creation_input_tokens,
          contextWindow: mu?.contextWindow,
          model,
          durationMs: typeof o.duration_ms === "number" ? o.duration_ms : undefined,
          quota: quota.length ? [...quota] : undefined,
          source: "Claude Code stream-json result event",
        });
        if (typeof o.result === "string") sink.setSummary(o.result);
        if (o.is_error || (typeof o.subtype === "string" && o.subtype !== "success")) {
          resultError = typeof o.result === "string" && o.result ? short(o.result, 400) : `Claude Code ended with ${o.subtype}`;
        }
        const denials = (o.permission_denials as unknown[] | undefined)?.length ?? 0;
        if (denials) sink.emit("status", `${denials} action${denials === 1 ? " was" : "s were"} blocked by the session's permissions.`);
      }
    });

    onLines(child.stderr!, (line) => {
      sink.raw?.("err", line);
      sink.emit("stderr", redact(line).slice(0, 500));
    });

    let cancelled = false;
    const done = new Promise<{ ok: boolean; error?: string }>((resolve) => {
      child.on("error", (e) => resolve({ ok: false, error: `Could not start Claude Code: ${e.message}` }));
      child.on("close", (code, signal) => {
        flush();
        if (cancelled) return resolve({ ok: false, error: "Stopped by you." });
        if (resultError) return resolve({ ok: false, error: resultError });
        if (code === 0 && gotResult) return resolve({ ok: true });
        resolve({ ok: false, error: signal ? `Claude Code was stopped (${signal}).` : `Claude Code exited with code ${code}. Check that you are signed in.` });
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
