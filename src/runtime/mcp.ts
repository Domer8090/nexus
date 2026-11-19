import { cacheGet, cacheSet } from "./db";
import { run } from "./proc";
import { redact } from "./redact";
import type { McpServer } from "@/lib/types";

/**
 * MCP manager. Reads and changes MCP config only through Claude Code's documented
 * `claude mcp list|add|remove` commands, never by editing its config files.
 */

export type CatalogServer = {
  id: string;
  name: string;
  category: string;
  summary: string;
  args: string[]; // argv after `--`
  source: string;
  license: string;
  permissions: string[];
  needsNode?: boolean;
  needsUv?: boolean;
};

/** Sources: github.com/modelcontextprotocol/servers (reference servers) and github.com/microsoft/playwright-mcp. */
export const MCP_CATALOG: CatalogServer[] = [
  { id: "playwright", name: "Playwright", category: "Browser automation", summary: "Lets the agent open pages, click and read them in a real browser.", args: ["npx", "@playwright/mcp@latest"], source: "https://github.com/microsoft/playwright-mcp", license: "Apache-2.0", permissions: ["Starts a browser", "Network access"], needsNode: true },
  { id: "filesystem", name: "Filesystem", category: "Files and search", summary: "Read and write files in folders you list. Nexus passes only the selected project.", args: ["npx", "-y", "@modelcontextprotocol/server-filesystem"], source: "https://github.com/modelcontextprotocol/servers", license: "Apache-2.0 / MIT", permissions: ["Reads and writes the project folder"], needsNode: true },
  { id: "git", name: "Git", category: "Git workflows", summary: "Reads history, diffs and status of a repository.", args: ["uvx", "mcp-server-git"], source: "https://github.com/modelcontextprotocol/servers", license: "Apache-2.0 / MIT", permissions: ["Reads git state", "Can create commits"], needsUv: true },
  { id: "fetch", name: "Fetch", category: "Documentation lookup", summary: "Fetches web pages and turns them into text for the agent.", args: ["uvx", "mcp-server-fetch"], source: "https://github.com/modelcontextprotocol/servers", license: "Apache-2.0 / MIT", permissions: ["Network access"], needsUv: true },
  { id: "memory", name: "Memory", category: "Context", summary: "A local knowledge graph the agent can store notes in.", args: ["npx", "-y", "@modelcontextprotocol/server-memory"], source: "https://github.com/modelcontextprotocol/servers", license: "Apache-2.0 / MIT", permissions: ["Writes a local memory file"], needsNode: true },
];

export function parseMcpList(out: string): McpServer[] {
  const items: McpServer[] = [];
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^(.+?):\s+(\S.*?)\s+-\s+(.+)$/);
    if (!m || line.startsWith("Checking")) continue;
    const [, name, targetRaw, statusText] = m;
    const transport = targetRaw.match(/\((HTTP|SSE|stdio)\)$/i)?.[1]?.toLowerCase() ?? (/^https?:/.test(targetRaw) ? "http" : "stdio");
    const target = targetRaw.replace(/\s*\((HTTP|SSE|stdio)\)$/i, "");
    const s = statusText.toLowerCase();
    const status: McpServer["status"] = s.includes("connected") && !s.includes("failed") ? "connected" : s.includes("auth") ? "needs-auth" : s.includes("pending") ? "pending-approval" : s.includes("failed") ? "failed" : "unknown";
    items.push({
      name,
      target: redact(target),
      transport,
      status,
      statusText: redact(statusText.replace(/^[✔✘!⏸]\s*/u, "")).slice(0, 200),
      source: name.startsWith("claude.ai ") ? "Claude account connector" : name.startsWith("plugin:") ? "Claude Code plugin" : "Claude Code config",
    });
  }
  return items;
}

export async function listMcp(cwd: string, force = false): Promise<{ servers: McpServer[]; checkedAt: string; error?: string }> {
  const key = `mcp:${cwd}`;
  if (!force) {
    const hit = cacheGet<{ servers: McpServer[]; checkedAt: string }>(key, 60_000);
    if (hit) return hit.value;
  }
  const r = await run("claude", ["mcp", "list"], { cwd, timeoutMs: 60_000 });
  const checkedAt = new Date().toISOString();
  if (r.code === 127) return { servers: [], checkedAt, error: "Claude Code is not installed, so Nexus can't read MCP config." };
  const value = { servers: parseMcpList(r.stdout), checkedAt };
  cacheSet(key, value);
  return value;
}

export function planAdd(id: string, projectPath: string) {
  const c = MCP_CATALOG.find((x) => x.id === id);
  if (!c) return null;
  const args = ["mcp", "add", "--scope", "project", c.id, "--", ...c.args, ...(c.id === "filesystem" ? [projectPath] : [])];
  return { args, preview: `claude ${args.join(" ")}`, writes: `${projectPath}/.mcp.json (project scope)` };
}

export async function addMcp(id: string, projectPath: string) {
  const plan = planAdd(id, projectPath);
  if (!plan) return { ok: false, output: "Unknown server." };
  const r = await run("claude", plan.args, { cwd: projectPath, timeoutMs: 60_000 });
  return { ok: r.code === 0, output: redact(r.stdout + r.stderr).slice(-2000) };
}

export async function removeMcp(name: string, projectPath: string) {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) return { ok: false, output: "Only servers added at project scope can be removed from Nexus." };
  const r = await run("claude", ["mcp", "remove", name, "--scope", "project"], { cwd: projectPath, timeoutMs: 30_000 });
  return { ok: r.code === 0, output: redact(r.stdout + r.stderr).slice(-2000) };
}
