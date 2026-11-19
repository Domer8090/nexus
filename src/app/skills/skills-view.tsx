"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlertTriangle, ChevronDown, Download, ExternalLink, Layers, PackagePlus, RefreshCw, Search, ShieldCheck, Trash2 } from "lucide-react";
import { ReviewBadge } from "@/components/agent-bits";
import { Badge, Button, CommandLine, ConfirmDialog, Drawer, EmptyState, PageHeader, Segmented, Spinner, Toast, cx, inputClass, selectClass } from "@/components/ui";
import { useWorkspace } from "@/components/workspace-context";
import { api, fmtNum, timeAgo, useApi, usePref } from "@/lib/client";
import { tidyPath } from "@/lib/format";
import { STACK_STAGES, type CatalogSkill, type InstalledSkill, type SkillDetail, type SkillStack, type StackStage } from "@/lib/types";

type Tab = "discover" | "collections" | "installed" | "stack";
type Collection = { id: string; title: string; summary: string; skills: { id: string; role: string }[]; conflicts?: string };
type Plan = { plan: { preview: string; destination: string }; review: SkillDetail["review"]; license: string | null; sourcePath: string | null; commit: string | null; error?: string };

const QUICK = ["frontend design", "testing", "debugging", "code review", "documentation", "security", "react", "python", "git"];
const AGENT_TARGETS = [
  { v: "claude-code", l: "Claude Code" },
  { v: "codex", l: "Codex" },
  { v: "gemini-cli", l: "Gemini CLI" },
  { v: "opencode", l: "OpenCode" },
];

function SkillInspector({ id, onClose, notify, onInstalled }: { id: string | null; onClose: () => void; notify: (m: string) => void; onInstalled: () => void }) {
  const { project } = useWorkspace();
  const d = useApi<SkillDetail>(id ? `/api/skills/detail?id=${encodeURIComponent(id)}` : null);
  const [tab, setTab] = useState<"overview" | "source" | "review">("overview");
  const [scope, setScope] = useState<"project" | "global">("project");
  const [agent, setAgent] = useState("claude-code");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [approve, setApprove] = useState(false);
  const [ack, setAck] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlan(null);
    setApprove(false);
    setAck(false);
    setResult(null);
    setTab("overview");
  }, [id, scope, agent]);

  const s = d.data;
  const review = s?.review;
  const makePlan = async () => {
    setPlanBusy(true);
    try {
      setPlan(await api<Plan>("/api/skills/install", { body: { id, scope, agent, projectId: project?.id ?? null, dryRun: true } }));
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setPlanBusy(false);
    }
  };
  const doInstall = async () => {
    setInstalling(true);
    try {
      const r = await api<{ output: string }>("/api/skills/install", { body: { id, scope, agent, projectId: project?.id ?? null, approve: true, acknowledgeReview: ack } });
      setResult(r.output);
      notify("Skill installed");
      onInstalled();
    } catch (e) {
      setResult((e as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-semibold">{s?.name ?? id?.split("@")[1]}</h2>
          <p className="truncate font-mono text-[12px] text-ink-3">{id}</p>
        </div>
      }
    >
      {d.loading && !s ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-2">
          <Spinner /> Reading source from GitHub and reviewing files…
        </p>
      ) : !s ? (
        <p className="text-bad">{d.error}</p>
      ) : (
        <div className="flex flex-col gap-4 text-[13.5px]">
          {s.error && (
            <p role="alert" className="rounded bg-bad-soft px-3 py-2 text-[13px] text-ink">
              {s.error} Metadata below is Unavailable where it could not be read.
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <ReviewBadge outcome={s.review.outcome} />
            <Badge>{s.license ?? "License: Unavailable"}</Badge>
            {s.hooks && <Badge tone="warn">Has hooks</Badge>}
            {s.files.some((f) => f.kind === "script") && <Badge tone="warn">Has scripts</Badge>}
          </div>
          <Segmented
            size="sm"
            label="Skill details"
            value={tab}
            onChange={setTab}
            options={[
              { value: "overview", label: "Overview" },
              { value: "source", label: "SKILL.md" },
              { value: "review", label: `Review (${s.review.findings.length})` },
            ]}
          />
          {tab === "overview" && (
            <>
              <p className="text-ink">{s.description || "No description in the frontmatter."}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
                <dt className="text-ink-3">Repository</dt>
                <dd>
                  <a href={s.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent underline underline-offset-2">
                    {s.owner}/{s.repo} <ExternalLink size={11} aria-hidden />
                  </a>
                </dd>
                <dt className="text-ink-3">Source path</dt>
                <dd className="font-mono">{s.sourcePath ?? "Unavailable"}</dd>
                <dt className="text-ink-3">Commit</dt>
                <dd className="font-mono">{s.commit ? `${s.commit.slice(0, 12)} on ${s.ref}` : "Unavailable"}</dd>
                <dt className="text-ink-3">Last change</dt>
                <dd>{s.lastCommitAt ? new Date(s.lastCommitAt).toLocaleDateString() : "Unavailable"}</dd>
                <dt className="text-ink-3">GitHub stars</dt>
                <dd>{s.stars != null ? `${fmtNum(s.stars)} (GitHub API, ${timeAgo(s.retrievedAt)})` : "Unavailable"}</dd>
                <dt className="text-ink-3">Allowed tools</dt>
                <dd>{s.allowedTools.length ? s.allowedTools.join(", ") : "None declared"}</dd>
                <dt className="text-ink-3">MCP servers named</dt>
                <dd>{s.mcpServers.length ? s.mcpServers.join(", ") : "None"}</dd>
                <dt className="text-ink-3">Dependencies</dt>
                <dd>{s.dependencies.length ? s.dependencies.slice(0, 12).join(", ") : "None declared"}</dd>
                <dt className="text-ink-3">Works with</dt>
                <dd>Agents that read the Agent Skills SKILL.md format; the Skills CLI links it per agent.</dd>
              </dl>
              <div>
                <h3 className="mb-1 text-[12.5px] font-semibold text-ink-2">Files ({s.files.length})</h3>
                <ul className="max-h-40 overflow-y-auto font-mono text-[11.5px]">
                  {s.files.map((f) => (
                    <li key={f.path} className="flex gap-2">
                      <span className={cx("w-12 shrink-0", f.kind === "script" ? "text-warn" : "text-ink-3")}>{f.kind}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-2">{f.path}</span>
                      <span className="text-ink-3">{f.size > 1024 ? `${Math.round(f.size / 1024)} KB` : `${f.size} B`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
          {tab === "source" && (
            <div className="prose-nexus rounded-[var(--radius-control)] border border-line p-3">
              {s.skillMd ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.skillMd.replace(/^---[\s\S]*?\n---\n?/, "")}</ReactMarkdown> : <p>SKILL.md: Unavailable.</p>}
            </div>
          )}
          {tab === "review" && review && (
            <div className="flex flex-col gap-3">
              <p className="text-[12.5px] text-ink-2">
                Best-effort static review on {new Date(review.reviewedAt).toLocaleString()}. It matches known risky patterns; it is not a guarantee of safety.
              </p>
              {review.findings.length === 0 ? (
                <p className="text-ok">No risky patterns found in the files checked.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {review.findings.map((f, i) => (
                    <li key={i} className="flex gap-2 text-[12.5px]">
                      <Badge tone={f.severity === "high" ? "bad" : f.severity === "medium" ? "warn" : "neutral"}>{f.severity}</Badge>
                      <span className="min-w-0">
                        <span className="font-mono text-ink">
                          {f.file}
                          {f.line ? `:${f.line}` : ""}
                        </span>{" "}
                        <span className="text-ink-2">{f.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <h3 className="text-[12.5px] font-semibold text-ink-2">Checked</h3>
                  <ul className="mt-1 list-disc pl-4 text-[12px] text-ink-2">
                    {review.checked.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-[12.5px] font-semibold text-ink-2">Not checked</h3>
                  <ul className="mt-1 list-disc pl-4 text-[12px] text-ink-2">
                    {review.notChecked.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <section className="rounded-[var(--radius-control)] border border-line p-3">
            <h3 className="mb-2 font-semibold">Install</h3>
            {s.review.outcome === "blocked" ? (
              <p className="text-bad">Blocked: the review found a pattern Nexus will not install (credential or data exfiltration risk, or destructive commands).</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Segmented
                    size="sm"
                    label="Install scope"
                    value={scope}
                    onChange={setScope}
                    options={[
                      { value: "project", label: project ? `Project: ${project.name}` : "Project" },
                      { value: "global", label: "Global (all projects)" },
                    ]}
                  />
                  <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
                    Agent
                    <select value={agent} onChange={(e) => setAgent(e.target.value)} className={cx(selectClass, "h-8 text-[12.5px]")}>
                      {AGENT_TARGETS.map((a) => (
                        <option key={a.v} value={a.v}>
                          {a.l}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {scope === "project" && !project && <p className="mt-2 text-[12.5px] text-warn">Select a project first, or install globally.</p>}
                {!plan ? (
                  <Button className="mt-3" onClick={makePlan} disabled={planBusy || (scope === "project" && !project)}>
                    {planBusy ? <Spinner /> : <PackagePlus size={14} aria-hidden />} Preview install
                  </Button>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    <p className="text-[12.5px] text-ink-2">Nexus will run the official Skills CLI:</p>
                    <CommandLine command={plan.plan.preview} />
                    <p className="text-[12.5px] text-ink-2">
                      Destination: <span className="font-mono">{tidyPath(plan.plan.destination)}</span>
                    </p>
                    <p className="text-[12.5px] text-ink-2">
                      Source: <span className="font-mono">{plan.sourcePath ?? "Unavailable"}</span> at <span className="font-mono">{plan.commit?.slice(0, 12) ?? "Unavailable"}</span>, license {plan.license ?? "Unavailable"}. The CLI fetches the repository&apos;s current default branch.
                    </p>
                    {plan.review.outcome !== "reviewed" && (
                      <label className="flex items-start gap-2 rounded border border-warn/40 bg-warn-soft p-2 text-[12.5px] text-ink">
                        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
                        I read the review findings ({plan.review.findings.filter((f) => f.severity !== "low" && f.severity !== "info").length} medium or high) and the skill&apos;s scripts. I accept the risk.
                      </label>
                    )}
                    <label className="flex items-start gap-2 text-[12.5px] text-ink">
                      <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
                      Run this command to install third-party instructions{s.files.some((f) => f.kind === "script") ? " and scripts" : ""} for {AGENT_TARGETS.find((a) => a.v === agent)?.l}.
                    </label>
                    <Button variant="primary" disabled={!approve || (plan.review.outcome !== "reviewed" && !ack) || installing} onClick={doInstall}>
                      {installing ? <Spinner /> : <Download size={14} aria-hidden />} Install skill
                    </Button>
                  </div>
                )}
                {result && <pre className="term mt-3 max-h-40 overflow-auto rounded border border-line p-2 text-[11px] whitespace-pre-wrap text-ink-2">{result}</pre>}
              </>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

function CatalogCard({ c, installed, onInspect }: { c: CatalogSkill; installed: boolean; onInspect: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 basis-56 items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-mono text-[13.5px] font-semibold text-ink">{c.skill}</h3>
          <p className="truncate text-[12px] text-ink-3">
            {c.owner}/{c.repo}
          </p>
        </div>
        {installed && <Badge tone="ok">Installed</Badge>}
      </div>
      <p className="text-[12px] text-ink-2">
        {c.installs != null ? `${fmtNum(c.installs)} installs` : "Installs: Unavailable"} <span className="text-ink-3">(skills.sh, {timeAgo(c.retrievedAt)})</span>
      </p>
      <div className="flex gap-1.5">
        <Button size="sm" variant="primary" onClick={onInspect}>
          <ShieldCheck size={13} aria-hidden /> Inspect
        </Button>
        <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-control)] px-2 text-[12.5px] text-ink-2 hover:bg-surface-2 hover:text-ink">
          skills.sh <ExternalLink size={11} aria-hidden />
        </a>
      </div>
    </li>
  );
}

function StackPanel({ installedAll, notify }: { installedAll: InstalledSkill[]; notify: (m: string) => void }) {
  const { project } = useWorkspace();
  const st = useApi<{ stack: SkillStack }>(project ? `/api/stacks/${project.id}` : null);
  const [draft, setDraft] = useState<SkillStack | null>(null);
  const [addId, setAddId] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (st.data) setDraft(st.data.stack);
  }, [st.data]);
  if (!project) return <EmptyState icon={<Layers size={28} />} title="Select a project" body="A skill stack belongs to one project." />;
  if (!draft) return <Spinner />;
  const style = draft.items.filter((i) => /frontend-design|impeccable|ui-ux-pro-max|design-taste/.test(i.id));
  const save = async (next: SkillStack) => {
    setDraft(next);
    try {
      await api(`/api/stacks/${project.id}`, { method: "PUT", body: { instructions: next.instructions, items: next.items } });
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const add = () => {
    const id = addId.trim();
    if (!/^[\w.-]+\/[\w.-]+@[\w.:-]+$/.test(id)) return notify("Use the owner/repo@skill form.");
    save({ ...draft, items: [...draft.items.filter((i) => i.id !== id), { id, stage: "build" }] });
    setAddId("");
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-ink-2">
        A stack lists the skills this project uses, by workflow stage. In the Playground, Nexus attaches only the skills relevant to the task, not the whole stack.
      </p>
      <div className="flex flex-wrap gap-2">
        <label htmlFor="stack-add" className="sr-only">
          Skill id
        </label>
        <input id="stack-add" list="stack-installed" value={addId} onChange={(e) => setAddId(e.target.value)} placeholder="owner/repo@skill" className={cx(inputClass, "max-w-sm font-mono text-[12.5px]")} />
        <datalist id="stack-installed">
          {installedAll.filter((s) => s.source).map((s) => (
            <option key={s.path} value={`${s.source}@${s.name}`} />
          ))}
        </datalist>
        <Button onClick={add}>Add to stack</Button>
        <a href={`/api/stacks/${project.id}?export=1`} className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-[13px] text-ink-2 hover:bg-surface-2 hover:text-ink">
          <Download size={14} aria-hidden /> Export manifest
        </a>
      </div>
      {style.length > 1 && (
        <p className="flex gap-2 rounded border border-warn/40 bg-warn-soft px-3 py-2 text-[12.5px] text-ink">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden /> {style.map((s) => s.id.split("@")[1]).join(", ")} all steer visual style. Pick one as the lead.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-5">
        {STACK_STAGES.map((stage) => (
          <section key={stage} className="rounded-[var(--radius-control)] border border-line p-2.5">
            <h3 className="mb-2 text-[12.5px] font-semibold capitalize text-ink-2">{stage}</h3>
            <ul className="flex flex-col gap-1.5">
              {draft.items
                .filter((i) => i.stage === stage)
                .map((i) => (
                  <li key={i.id} className="rounded border border-line bg-surface-2 p-1.5">
                    <p className="truncate font-mono text-[11.5px] text-ink" title={i.id}>
                      {i.id.split("@")[1]}
                    </p>
                    <div className="mt-1 flex gap-1">
                      <select
                        aria-label={`Stage for ${i.id}`}
                        value={i.stage}
                        onChange={(e) => save({ ...draft, items: draft.items.map((x) => (x.id === i.id ? { ...x, stage: e.target.value as StackStage } : x)) })}
                        className="min-w-0 flex-1 rounded border border-line bg-surface px-1 text-[11px]"
                      >
                        {STACK_STAGES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                      <button aria-label={`Remove ${i.id} from stack`} onClick={() => save({ ...draft, items: draft.items.filter((x) => x.id !== i.id) })} className="rounded px-1 text-ink-3 hover:text-bad">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
      <div>
        <label htmlFor="stack-instr" className="mb-1 block text-[12.5px] font-medium text-ink-2">
          Project instructions for agents
        </label>
        <textarea
          id="stack-instr"
          rows={3}
          value={draft.instructions}
          onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
          onBlur={() => save(draft)}
          className={inputClass}
          placeholder="Use pnpm. Keep components in src/components. Tests live next to the code."
        />
      </div>
    </div>
  );
}

export function SkillsView() {
  const { project } = useWorkspace();
  const [tab, setTab] = usePref<Tab>("skillsTab", "discover");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("frontend design");
  const [inspect, setInspect] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<InstalledSkill | null>(null);
  const notify = (m: string) => {
    setToast(m);
    window.setTimeout(() => setToast(null), 3500);
  };
  const search = useApi<{ items: CatalogSkill[]; retrievedAt: string; cached: boolean; error?: string }>(tab === "discover" ? `/api/skills/search?q=${encodeURIComponent(query)}` : null);
  const cols = useApi<{ collections: Collection[]; verifiedOn: string }>("/api/skills/collections");
  const inst = useApi<{ project: InstalledSkill[]; global: InstalledSkill[]; history: { skill_id: string; scope: string; agent: string; commit_sha: string | null; license: string | null; review: string | null; action: string; at: string }[] }>(
    `/api/skills/installed${project ? `?projectId=${project.id}` : ""}`,
  );
  const installedAll = useMemo(() => [...(inst.data?.project ?? []), ...(inst.data?.global ?? [])], [inst.data]);
  const isInstalled = (skill: string) => installedAll.some((s) => s.name.toLowerCase() === skill.toLowerCase());

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("inspect");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id) setInspect(id);
  }, []);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Skills" pixel="Skills" heading="Skills for Claude Code and Codex"
        sub="Read the source and the security review on skills.sh, then install through the official Skills CLI after you approve."
        actions={
          <Segmented<Tab>
            label="Skills section"
            value={tab}
            onChange={setTab}
            options={[
              { value: "discover", label: "Discover" },
              { value: "collections", label: "Collections" },
              { value: "installed", label: `Installed (${installedAll.length})` },
              { value: "stack", label: "Project stack" },
            ]}
          />
        }
      />

      {tab === "discover" && (
        <>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) setQuery(q.trim());
            }}
          >
            <div className="relative flex-1">
              <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" aria-hidden />
              <label htmlFor="skill-q" className="sr-only">
                Search skills
              </label>
              <input id="skill-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by task, tool or name" className={cx(inputClass, "pl-9")} />
            </div>
            <Button type="submit" variant="primary">
              Search skills.sh
            </Button>
          </form>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick searches">
            {QUICK.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={query === k}
                onClick={() => {
                  setQuery(k);
                  setQ(k);
                }}
                className={cx("rounded-full border px-2.5 py-0.5 text-[12.5px]", query === k ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2 hover:text-ink")}
              >
                {k}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-ink-3" aria-live="polite">
            {search.loading ? "Searching skills.sh…" : search.data ? `${search.data.items.length} results for “${query}”, sorted by skills.sh install count. License and review appear after you inspect one. Retrieved ${timeAgo(search.data.retrievedAt)}${search.data.cached ? " (cached)" : ""}.` : ""}
          </p>
          {search.data?.error && <p className="mt-2 text-bad">{search.data.error}</p>}
          {search.loading && !search.data ? (
            <Spinner className="mt-4" />
          ) : (
            <ul className="panel mt-3 divide-y divide-line" aria-label="Search results">
              {search.data?.items.map((c) => (
                <CatalogCard key={c.id} c={c} installed={isInstalled(c.skill)} onInspect={() => setInspect(c.id)} />
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "collections" && (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-ink-2">
            Starting points, each skill confirmed on skills.sh on {cols.data?.verifiedOn}. They are not endorsements: inspect each one, then install one at a time.
          </p>
          <div className="panel divide-y divide-line">
          {cols.data?.collections.map((c, ci) => (
            <details key={c.id} open={ci === 0} className="group p-4">
              <summary className="flex cursor-pointer list-none items-center gap-2">
                <ChevronDown size={14} className="shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
                <span className="font-semibold text-ink">{c.title}</span>
                <span className="text-[12px] text-ink-3">{c.skills.length} skills</span>
              </summary>
              <p className="mt-2 text-[13px] text-ink-2">{c.summary}</p>
              {c.conflicts && (
                <p className="mt-2 flex gap-2 text-[12.5px] text-warn">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden /> {c.conflicts}
                </p>
              )}
              <ul className="mt-3 flex flex-col divide-y divide-line">
                {c.skills.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12.5px] text-ink">{s.id}</span>
                      <span className="text-[12px] text-ink-3">{s.role}</span>
                    </span>
                    {isInstalled(s.id.split("@")[1]) && <Badge tone="ok">Installed</Badge>}
                    <Button size="sm" onClick={() => setInspect(s.id)}>
                      Inspect
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          </div>
        </div>
      )}

      {tab === "installed" && (
        <div className="flex flex-col gap-5">
          <p className="text-[12.5px] text-ink-3">
            Read from <span className="font-mono">skills list --json</span>. The Skills CLI has no disable command, so Nexus offers update and remove. Remove deletes the skill from the agents it was linked to.
          </p>
          {(["project", "global"] as const).map((scope) => {
            const list = scope === "project" ? inst.data?.project ?? [] : inst.data?.global ?? [];
            return (
              <section key={scope}>
                <h3 className="mb-2 text-[13px] font-semibold text-ink-2">
                  {scope === "project" ? `Project: ${project?.name ?? "none selected"}` : "Global"} ({list.length})
                </h3>
                {inst.loading && !inst.data ? (
                  <Spinner />
                ) : list.length === 0 ? (
                  <p className="text-[13px] text-ink-3">None.</p>
                ) : (
                  <ul className="panel divide-y divide-line">
                    {list.map((s) => (
                      <li key={s.path} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-[13px] text-ink">{s.name}</span>
                          <span className="block truncate text-[11.5px] text-ink-3">
                            {s.source ?? "Unknown source"}, {s.agents.join(", ") || "no agents linked"}, {tidyPath(s.path)}
                          </span>
                        </span>
                        {s.source && (
                          <Button size="sm" variant="ghost" onClick={() => setInspect(`${s.source}@${s.name}`)}>
                            Source
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await api("/api/skills/update", { body: { name: s.name, scope, projectId: project?.id ?? null, confirm: true } });
                              notify(`Checked ${s.name} for updates`);
                              inst.reload();
                            } catch (e) {
                              notify((e as Error).message);
                            }
                          }}
                        >
                          <RefreshCw size={13} aria-hidden /> Update
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setRemoveTarget(s)}>
                          <Trash2 size={13} aria-hidden /> Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          {inst.data?.history.length ? (
            <details>
              <summary className="mb-2 cursor-pointer text-[13px] font-semibold text-ink-2">Install history (Nexus)</summary>
              <ul className="font-mono text-[11.5px] text-ink-2">
                {inst.data.history.slice(0, 20).map((h, i) => (
                  <li key={i}>
                    {h.at.slice(0, 16).replace("T", " ")} {h.action} {h.skill_id} ({h.scope}, {h.agent}){h.commit_sha ? ` @${h.commit_sha.slice(0, 8)}` : ""}
                    {h.review ? `, review: ${h.review}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}

      {tab === "stack" && <StackPanel installedAll={installedAll} notify={notify} />}

      <SkillInspector id={inspect} onClose={() => setInspect(null)} notify={notify} onInstalled={inst.reload} />
      <ConfirmDialog
        open={!!removeTarget}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={async () => {
          const s = removeTarget!;
          setRemoveTarget(null);
          try {
            await api("/api/skills/remove", { body: { name: s.name, scope: s.scope, projectId: project?.id ?? null, confirm: true } });
            notify(`Removed ${s.name}`);
            inst.reload();
          } catch (e) {
            notify((e as Error).message);
          }
        }}
        title={`Remove ${removeTarget?.name}?`}
        body={
          <p>
            Runs <span className="font-mono">skills remove {removeTarget?.name} -y{removeTarget?.scope === "global" ? " -g" : ""}</span>, which deletes it from {removeTarget?.agents.join(", ") || "its agents"}. You can reinstall it later.
          </p>
        }
        confirmLabel="Remove skill"
        danger
      />
      <Toast message={toast} />
    </div>
  );
}
