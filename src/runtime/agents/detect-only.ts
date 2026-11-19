import { run, which, type AllowedExe } from "../proc";
import type { AgentAdapter } from "./types";

/**
 * Agents Nexus detects but does not drive yet. Install and sign-in commands come
 * from each project's official docs (see README, "Sources"). Nexus does not read
 * their credential stores, so sign-in state is "Unknown" unless a documented
 * status command exists.
 */

type Def = AgentAdapter["meta"] & { exe: AllowedExe };

function make(def: Def): AgentAdapter {
  const { exe, ...meta } = def;
  return {
    id: meta.id,
    meta,
    async detect() {
      const bin = which(exe);
      if (!bin) return { install: "not-installed", version: null, binaryPath: null, auth: "unavailable", authDetail: `${meta.displayName} is not installed.`, accountFacts: [], models: [] };
      const v = await run(exe, ["--version"], { timeoutMs: 8000 });
      const version = (v.stdout || v.stderr).match(/\d+\.\d+(\.\d+)?[\w.-]*/)?.[0] ?? null;
      return {
        install: "installed",
        version,
        binaryPath: bin,
        auth: "unknown",
        authDetail: "Installed. Nexus does not read this agent's credentials, so sign-in state is unknown. Use its own sign-in command.",
        accountFacts: [],
        models: [],
      };
    },
  };
}

export const detectOnlyAdapters: AgentAdapter[] = [
  make({
    exe: "jcode",
    id: "jcode",
    displayName: "Jcode",
    vendor: "Jcode (open source)",
    kind: "harness",
    integration: "detection-only",
    integrationNote: "Evaluated: Jcode documents subscription sign-in and `jcode run`, but no JSON or streaming output mode, so Nexus can't capture its events reliably yet. Launch it in a terminal for now.",
    capabilities: ["interactive", "headless", "parallel", "edits-project", "resume"],
    nexusCapabilities: [],
    installCommands: [
      { label: "Install script", command: "curl -fsSL https://jcode.sh/install | bash" },
      { label: "Homebrew", command: "brew tap 1jehuang/jcode && brew install jcode" },
    ],
    loginCommand: { label: "Sign in with a Claude subscription (other providers listed by `jcode login`)", command: "jcode login --provider claude", runnable: true },
    docsUrl: "https://jcode.sh/docs",
    license: "MIT",
    eligibility: "Supports subscription OAuth (Claude, OpenAI, Gemini, Copilot) and local Ollama or LM Studio, per jcode.sh/docs. Its docs say they are in maintenance.",
  }),
  make({
    exe: "gemini",
    id: "gemini-cli",
    displayName: "Gemini CLI",
    vendor: "Google",
    kind: "coding-cli",
    integration: "detection-only",
    integrationNote: "Detection only. Gemini CLI documents `-p` with `--output-format stream-json`, but Nexus has not tested it.",
    capabilities: ["interactive", "headless", "streaming", "edits-project", "mcp"],
    nexusCapabilities: [],
    installCommands: [
      { label: "npm", command: "npm install -g @google/gemini-cli" },
      { label: "Homebrew", command: "brew install gemini-cli" },
    ],
    loginCommand: { label: "Run `gemini`, then choose Sign in with Google", command: "gemini", runnable: true },
    docsUrl: "https://github.com/google-gemini/gemini-cli",
    license: "Apache-2.0",
    eligibility: "Its README says free individual access and Google AI Pro / Ultra moved to Antigravity CLI on 2026-06-18; Gemini CLI now targets Gemini Code Assist Standard and Enterprise.",
  }),
  make({
    exe: "opencode",
    id: "opencode",
    displayName: "OpenCode",
    vendor: "OpenCode (open source)",
    kind: "coding-cli",
    integration: "detection-only",
    integrationNote: "Detection only. Its docs page did not state a JSON output mode for `opencode run`, so Nexus does not launch it yet.",
    capabilities: ["interactive", "edits-project"],
    nexusCapabilities: [],
    installCommands: [
      { label: "Install script", command: "curl -fsSL https://opencode.ai/v2/install | bash" },
      { label: "npm", command: "npm install -g @opencode/cli" },
    ],
    loginCommand: { label: "Open OpenCode and use /connect", command: "opencode", runnable: true },
    docsUrl: "https://opencode.ai/docs",
    license: "Not stated on its docs page",
    eligibility: "Connects to providers from the TUI with /connect. Check each provider's terms for subscription use.",
  }),
  make({
    exe: "lms",
    id: "lm-studio",
    displayName: "LM Studio",
    vendor: "LM Studio",
    kind: "local-runtime",
    integration: "detection-only",
    integrationNote: "Detection only. Start its server with `lms server start`.",
    capabilities: ["local-models", "headless"],
    nexusCapabilities: [],
    installCommands: [{ label: "Install LM Studio, open it once, then `lms` is available", command: "open https://lmstudio.ai" }],
    loginCommand: null,
    docsUrl: "https://lmstudio.ai/docs/cli",
    license: "lms CLI: MIT",
    eligibility: "No account. Local models only.",
  }),
  make({
    exe: "aider",
    id: "aider",
    displayName: "Aider",
    vendor: "Aider (open source)",
    kind: "coding-cli",
    integration: "out-of-scope",
    integrationNote: "Out of scope for this version: Aider's install docs show provider API keys as the way to connect, and Nexus does not use API keys.",
    capabilities: ["interactive", "edits-project"],
    nexusCapabilities: [],
    installCommands: [{ label: "pipx", command: "pipx install aider-chat" }],
    loginCommand: null,
    docsUrl: "https://aider.chat/docs/install.html",
    license: "Not stated on its install page",
    eligibility: "Documented with API keys. Could work with a local model through Ollama; not evaluated.",
  }),
];
