"use client";

import Link from "next/link";
import { useState } from "react";
import { LogIn, Play, RefreshCw } from "lucide-react";
import { AgentMark, AuthBadge, InstallBadge, IntegrationBadge } from "@/components/agent-bits";
import { Badge, Button, CommandLine, Drawer, PageHeader, Rich, Segmented, Spinner, Toast, cx } from "@/components/ui";
import { useWorkspace } from "@/components/workspace-context";
import { api, timeAgo, usePref } from "@/lib/client";
import { CAPABILITY_LABELS, type AgentStatus, type Capability } from "@/lib/types";

const KIND: Record<AgentStatus["kind"], string> = { "coding-cli": "Coding CLI", harness: "Agent harness", "local-runtime": "Local runtime" };
const MATRIX: Capability[] = ["headless", "streaming", "parallel", "edits-project", "skills", "mcp", "resume", "usage"];

function CapCell({ a, c }: { a: AgentStatus; c: Capability }) {
  const nexus = a.nexusCapabilities.includes(c);
  const agent = a.capabilities.includes(c);
  if (nexus) return <span className="text-ok">Yes</span>;
  if (agent) return <span className="text-ink-3">Agent only</span>;
  return <span className="text-ink-3">No</span>;
}

function SignIn({ a, onDone }: { a: AgentStatus; onDone: (msg: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (!a.loginCommand || a.install !== "installed") return null;
  return (
    <Button
      size="sm"
      variant={a.auth === "needs-sign-in" ? "primary" : "secondary"}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/api/agents/${a.id}/login`, { method: "POST", body: {} });
          onDone(`Opened Terminal with \`${a.loginCommand!.command}\`. Finish signing in there, then check again.`);
        } catch (e) {
          onDone((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <LogIn size={14} aria-hidden /> {a.auth === "authenticated" ? "Sign in again" : "Sign in"}
    </Button>
  );
}

export function AgentsView() {
  const { agents, agentsLoading, agentsError, reloadAgents } = useWorkspace();
  const [view, setView] = usePref<"grid" | "list">("agentsView", "grid");
  const [open, setOpen] = useState<AgentStatus | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const notify = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 5000);
  };
  const lastCheck = agents[0]?.checkedAt;
  const launchable = (a: AgentStatus) => a.integration === "supported" && a.install === "installed" && (a.auth === "authenticated" || a.auth === "not-required");

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Agent fleet" pixel="Agents" heading="Coding agents on this computer"
        sub="Each one signs in with its own account, and Nexus never asks for an API key."
        actions={
          <>
            <Segmented
              size="sm"
              label="Layout"
              value={view}
              onChange={setView}
              options={[
                { value: "grid", label: "Grid" },
                { value: "list", label: "Capabilities" },
              ]}
            />
            <Button size="sm" onClick={() => reloadAgents(true)} disabled={agentsLoading}>
              {agentsLoading ? <Spinner /> : <RefreshCw size={14} aria-hidden />} Check again
            </Button>
          </>
        }
      />
      {agentsError && (
        <p role="alert" className="mb-4 text-[12.5px] text-bad">
          {agentsError}
        </p>
      )}

      {view === "grid" ? (
        <div className="flex flex-col gap-4">
          {[
            { label: "On this computer", list: agents.filter((a) => a.install === "installed") },
            { label: "Not installed", list: agents.filter((a) => a.install !== "installed") },
          ]
            .filter((g) => g.list.length)
            .map((g) => (
              <section key={g.label} className="panel">
                <h3 className="eyebrow border-b border-line px-4 py-3">
                  {g.label} ({g.list.length})
                </h3>
                <ul className="divide-y divide-line">
                  {g.list.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <AgentMark agent={a} size="md" />
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="font-semibold text-ink">{a.displayName}</p>
                        <p className="truncate text-[12px] text-ink-3">
                          {a.vendor}, {KIND[a.kind]}
                          {a.install === "installed" && a.version ? `, ${a.version}` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {a.install === "installed" ? <AuthBadge a={a} /> : <InstallBadge a={a} />}
                        <IntegrationBadge a={a} />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {launchable(a) && (
                          <Link
                            href={`/playground?agent=${a.id}`}
                            className="btn-step inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-accent bg-accent px-2.5 font-mono text-[11.5px] font-medium tracking-[0.04em] text-accent-ink hover:bg-accent-hover max-sm:min-h-11"
                          >
                            <Play size={13} aria-hidden /> New session
                          </Link>
                        )}
                        <SignIn a={a} onDone={notify} />
                        <Button size="sm" variant="ghost" onClick={() => setOpen(a)}>
                          {a.install === "installed" ? "Details" : "Install"}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          <p className="text-[12px] text-ink-3" aria-live="polite">
            Last health check {timeAgo(lastCheck)}. Details shows each agent&apos;s note, account facts and docs.
          </p>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[860px] text-[12.5px]">
            <caption className="sr-only">Agent capabilities. Yes means Nexus drives it today; Agent only means the agent has it but Nexus does not use it yet.</caption>
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th scope="col" className="px-3 py-2 font-medium">Agent</th>
                <th scope="col" className="px-3 py-2 font-medium">Installed</th>
                <th scope="col" className="px-3 py-2 font-medium">Sign-in</th>
                {MATRIX.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 font-medium">
                    {CAPABILITY_LABELS[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <th scope="row" className="px-3 py-2 text-left font-medium text-ink">
                    <button className="hover:text-accent" onClick={() => setOpen(a)}>
                      {a.displayName}
                    </button>
                  </th>
                  <td className="px-3 py-2 text-ink-2">{a.install === "installed" ? a.version ?? "Yes, version unknown" : "No"}</td>
                  <td className="px-3 py-2 text-ink-2">
                    {a.install !== "installed" ? "Not detected" : { authenticated: "Signed in", "needs-sign-in": "Needs sign-in", "not-required": "Not needed", unknown: "Unknown", unavailable: "Unavailable" }[a.auth]}
                  </td>
                  {MATRIX.map((c) => (
                    <td key={c} className="px-3 py-2">
                      <CapCell a={a} c={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-[12px] text-ink-3">Yes: Nexus drives this today. Agent only: the agent documents it, Nexus does not use it yet.</p>
        </div>
      )}

      <Drawer
        open={!!open}
        onClose={() => setOpen(null)}
        title={
          open && (
            <div className="flex items-center gap-3">
              <AgentMark agent={open} size="lg" />
              <div>
                <h2 className="text-[17px] font-semibold">{open.displayName}</h2>
                <p className="text-[12.5px] text-ink-3">
                  {open.vendor}, license: {open.license}
                </p>
              </div>
            </div>
          )
        }
      >
        {open && (
          <div className="flex flex-col gap-5 text-[13.5px]">
            <div className="flex flex-wrap gap-1.5">
              <InstallBadge a={open} />
              <AuthBadge a={open} />
              <IntegrationBadge a={open} />
            </div>
            <section>
              <h3 className="mb-1 font-semibold">Status</h3>
              <p className="text-ink-2"><Rich text={open.integrationNote} /></p>
              <p className="mt-1 text-ink-2"><Rich text={open.authDetail} /></p>
              {open.binaryPath && <p className="mt-1 font-mono text-[12px] text-ink-3">{open.binaryPath.replace(/^\/(Users|home)\/[^/]+/, "~")}</p>}
              {open.models.length > 0 && (
                <p className="mt-2 text-ink-2">
                  {open.kind === "local-runtime" ? "Local models: " : "Model aliases: "}
                  {open.models.map((m) => (
                    <Badge key={m} className="mr-1 font-mono">
                      {m}
                    </Badge>
                  ))}
                </p>
              )}
            </section>
            <section>
              <h3 className="mb-1 font-semibold">Account and eligibility</h3>
              <p className="text-ink-2"><Rich text={open.eligibility} /></p>
              {open.accountFacts.length > 0 && (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                  {open.accountFacts.map((f) => (
                    <div key={f.label} className="contents">
                      <dt className="text-ink-3">{f.label}</dt>
                      <dd className="text-ink-2">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
            {open.loginCommand && (
              <section>
                <h3 className="mb-1.5 font-semibold">Sign in with the agent&apos;s own flow</h3>
                <p className="mb-2 text-ink-2">{open.loginCommand.label}. Credentials stay in the agent&apos;s own store; Nexus never sees them.</p>
                <CommandLine command={open.loginCommand.command} />
              </section>
            )}
            <section>
              <h3 className="mb-1.5 font-semibold">Install (official commands)</h3>
              <p className="mb-2 text-ink-2">Nexus does not run install scripts for you. Copy one, review it, and run it in your terminal.</p>
              <div className="flex flex-col gap-2">
                {open.installCommands.map((c) => (
                  <div key={c.command}>
                    <p className="mb-1 text-[12px] text-ink-3">{c.label}</p>
                    <CommandLine command={c.command} />
                  </div>
                ))}
              </div>
            </section>
            <section>
              <h3 className="mb-1.5 font-semibold">Capabilities</h3>
              <ul className="grid grid-cols-2 gap-1.5 text-[12.5px]">
                {(Object.keys(CAPABILITY_LABELS) as Capability[]).map((c) => (
                  <li key={c} className={cx("flex items-center justify-between rounded border border-line px-2 py-1", !open.capabilities.includes(c) && "opacity-60")}>
                    <span>{CAPABILITY_LABELS[c]}</span>
                    <CapCell a={open} c={c} />
                  </li>
                ))}
              </ul>
            </section>
            <a href={open.docsUrl} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
              Official documentation
            </a>
          </div>
        )}
      </Drawer>
      <Toast message={toast} />
    </div>
  );
}
