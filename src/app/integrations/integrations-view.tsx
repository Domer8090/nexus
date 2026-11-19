"use client";

import { useState } from "react";
import { ExternalLink, Plug, RefreshCw, Trash2 } from "lucide-react";
import { Badge, Button, CommandLine, ConfirmDialog, Dialog, EmptyState, PageHeader, Spinner, Toast } from "@/components/ui";
import { useWorkspace } from "@/components/workspace-context";
import { api, timeAgo, useApi } from "@/lib/client";
import type { McpServer } from "@/lib/types";

type Catalog = { id: string; name: string; category: string; summary: string; source: string; license: string; permissions: string[]; needsNode?: boolean; needsUv?: boolean; plan: { preview: string; writes: string } | null };

const TONE: Record<McpServer["status"], "ok" | "warn" | "bad" | "neutral"> = { connected: "ok", "needs-auth": "warn", failed: "bad", "pending-approval": "warn", unknown: "neutral" };
const LABEL: Record<McpServer["status"], string> = { connected: "Connected", "needs-auth": "Needs sign-in", failed: "Failed", "pending-approval": "Pending approval", unknown: "Unknown" };

export function IntegrationsView() {
  const { project } = useWorkspace();
  const [force, setForce] = useState(0);
  const d = useApi<{ servers: McpServer[]; checkedAt: string; error?: string; catalog: Catalog[] }>(`/api/mcp?${project ? `projectId=${project.id}&` : ""}${force ? "force=1&n=" + force : ""}`);
  const [add, setAdd] = useState<Catalog | null>(null);
  const [rm, setRm] = useState<McpServer | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const notify = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 4000);
  };
  const servers = d.data?.servers ?? [];
  const names = new Set(servers.map((s) => s.name));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Integrations" pixel="MCP" heading="MCP servers for your agents"
        sub={<>Added and removed through Claude Code&apos;s own <code className="font-mono">claude mcp</code> commands. Popular doesn&apos;t mean trusted, so check what each server can do.</>}
        actions={
          <Button size="sm" onClick={() => setForce((n) => n + 1)} disabled={d.loading}>
            {d.loading ? <Spinner /> : <RefreshCw size={14} aria-hidden />} Check health
          </Button>
        }
      />
      <section className="mb-6">
        <h3 className="mb-2 text-[13px] font-semibold text-ink-2">Configured for Claude Code{project ? ` in ${project.name}` : ""}</h3>
        {d.loading && !d.data ? (
          <p className="flex items-center gap-2 text-[13px] text-ink-3">
            <Spinner /> Running <span className="font-mono">claude mcp list</span> (it health-checks each server)…
          </p>
        ) : d.data?.error ? (
          <p className="text-[13px] text-ink-2">{d.data.error}</p>
        ) : servers.length === 0 ? (
          <EmptyState icon={<Plug size={26} />} title="No MCP servers" body="Add one from the catalog below." />
        ) : (
          <>
            <ul className="panel divide-y divide-line">
              {servers.map((s) => (
                <li key={s.name} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{s.name}</span>
                    <span className="block truncate font-mono text-[11.5px] text-ink-3">
                      {s.transport}, {s.target}
                    </span>
                  </span>
                  <span className="text-[11.5px] text-ink-3">{s.source}</span>
                  <Badge tone={TONE[s.status]}>{LABEL[s.status]}</Badge>
                  {s.status === "failed" && <span className="w-full text-[12px] text-bad">{s.statusText}</span>}
                  {s.source === "Claude Code config" && /^[A-Za-z0-9_.-]+$/.test(s.name) && project && (
                    <Button size="sm" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => setRm(s)}>
                      <Trash2 size={13} />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11.5px] text-ink-3">Checked {timeAgo(d.data?.checkedAt)} by Claude Code. Sign in to account connectors from Claude Code itself.</p>
          </>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold text-ink-2">Catalog</h3>
        <p className="mb-3 text-[12.5px] text-ink-3">Reference servers from the Model Context Protocol project and Microsoft&apos;s Playwright MCP. Added at project scope, written to the project&apos;s .mcp.json, which Claude Code asks you to approve before first use.</p>
        <ul className="panel divide-y divide-line" aria-label="Catalog">
          {d.data?.catalog.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start gap-3 p-4">
              <div className="min-w-0 flex-1 basis-64">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{c.name}</span>
                  <span className="text-[12px] text-ink-3">{c.category}</span>
                  {names.has(c.id) ? <Badge tone="ok">Added</Badge> : <Badge>{c.license}</Badge>}
                </p>
                <p className="mt-1 text-[13px] text-ink-2">{c.summary}</p>
                <p className="mt-1 text-[12px] text-ink-3">
                  Can: {c.permissions.join(", ").toLowerCase()}
                  {c.needsUv ? ". Needs uv" : ""}
                  {c.needsNode ? ". Needs Node.js" : ""}.
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="primary" disabled={!project || names.has(c.id)} onClick={() => setAdd(c)}>
                  Add to project
                </Button>
                <a href={c.source} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-control)] px-2 text-[12.5px] text-ink-2 hover:bg-surface-2 hover:text-ink">
                  Source <ExternalLink size={11} aria-hidden />
                </a>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Dialog
        open={!!add}
        onClose={() => setAdd(null)}
        title={`Add ${add?.name} to ${project?.name}?`}
        footer={
          <>
            <Button onClick={() => setAdd(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/api/mcp/add", { body: { id: add!.id, projectId: project!.id, confirm: true } });
                  notify(`${add!.name} added. Claude Code will ask you to approve it on first use.`);
                  setAdd(null);
                  setForce((n) => n + 1);
                } catch (e) {
                  notify((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner /> : null} Run command
            </Button>
          </>
        }
      >
        {add?.plan && (
          <div className="flex flex-col gap-2">
            <p>Nexus will run:</p>
            <CommandLine command={add.plan.preview} />
            <p>Writes: {add.plan.writes}</p>
            <p>It can: {add.permissions.join(", ").toLowerCase()}. The package is downloaded from npm or PyPI when an agent first starts it.</p>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!rm}
        onCancel={() => setRm(null)}
        onConfirm={async () => {
          const s = rm!;
          setRm(null);
          try {
            await api("/api/mcp/remove", { body: { name: s.name, projectId: project!.id, confirm: true } });
            notify(`Removed ${s.name}`);
            setForce((n) => n + 1);
          } catch (e) {
            notify((e as Error).message);
          }
        }}
        title={`Remove ${rm?.name}?`}
        body={<p>Runs <span className="font-mono">claude mcp remove {rm?.name} --scope project</span>. Servers in other scopes must be removed from Claude Code directly.</p>}
        confirmLabel="Remove server"
        danger
      />
      <Toast message={toast} />
    </div>
  );
}
