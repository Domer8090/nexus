import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { redact } from "./redact";

/**
 * Process manager. Rules:
 * - Only executables on ALLOWED run, resolved to an absolute path.
 * - Arguments are always an array. No shell, no string interpolation.
 * - Provider API-key variables are stripped from agent environments so each
 *   agent uses its own sign-in (Nexus never falls back to API keys).
 */

export const ALLOWED = ["claude", "ollama", "git", "node", "codex", "gemini", "opencode", "jcode", "aider", "lms", "osascript", "npm", "open", "caffeinate", "networksetup", "pmset", "ps"] as const;
export type AllowedExe = (typeof ALLOWED)[number];

const STRIP_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENAI_USE_VERTEXAI",
];

function searchPath() {
  const extra = [path.join(os.homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", path.join(os.homedir(), ".cargo/bin"), path.join(os.homedir(), ".opencode/bin")];
  const fromEnv = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return Array.from(new Set([...fromEnv, ...extra]));
}

const resolved = new Map<string, string | null>();

export function which(exe: AllowedExe): string | null {
  if (resolved.has(exe)) return resolved.get(exe)!;
  let found: string | null = null;
  for (const dir of searchPath()) {
    const p = path.join(dir, exe);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      found = p;
      break;
    } catch {}
  }
  resolved.set(exe, found);
  return found;
}

export function clearWhichCache() {
  resolved.clear();
}

export function agentEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: searchPath().join(path.delimiter), NO_COLOR: "1", FORCE_COLOR: "0" };
  for (const k of STRIP_ENV) delete env[k];
  return env;
}

export function commandPreview(exe: string, args: string[]) {
  const q = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  const shown = args.map((a) => (a.length > 120 ? `${a.slice(0, 117)}…` : a));
  return redact([exe, ...shown].map(q).join(" "));
}

export type RunResult = { code: number | null; stdout: string; stderr: string; timedOut: boolean };

/** Short command with a timeout. Output capped at 2 MB. */
export function run(exe: AllowedExe, args: string[], opts: { cwd?: string; timeoutMs?: number; input?: string; maxBytes?: number } = {}): Promise<RunResult> {
  const bin = which(exe);
  if (!bin) return Promise.resolve({ code: 127, stdout: "", stderr: `${exe} not found`, timedOut: false });
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: agentEnv(), stdio: [opts.input ? "pipe" : "ignore", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = opts.maxBytes ?? 2 * 1024 * 1024;
    child.stdout?.on("data", (d) => (stdout.length < cap ? (stdout += d) : null));
    child.stderr?.on("data", (d) => (stderr.length < cap ? (stderr += d) : null));
    if (opts.input) {
      child.stdin?.end(opts.input);
    }
    const t = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, opts.timeoutMs ?? 15_000);
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: 1, stdout, stderr: String(e.message), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** Long-running process in its own process group so cancel stops its children too. */
export function spawnLong(exe: AllowedExe, args: string[], cwd: string): ChildProcess {
  const bin = which(exe);
  if (!bin) throw new Error(`${exe} is not installed`);
  return spawn(bin, args, { cwd, env: agentEnv(), stdio: ["ignore", "pipe", "pipe"], shell: false, detached: true });
}

export function killTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  if (child.pid == null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

/** Line splitter for NDJSON streams. */
export function onLines(stream: NodeJS.ReadableStream, cb: (line: string) => void) {
  let buf = "";
  stream.on("data", (d: Buffer) => {
    buf += d.toString("utf8");
    let i: number;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) cb(line);
    }
  });
  stream.on("end", () => {
    if (buf.trim()) cb(buf.trim());
  });
}
