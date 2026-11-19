"use client";

import Link from "next/link";
import { FileDiff, GitBranch } from "lucide-react";
import { AgentMark, AuthBadge } from "./agent-bits";
import { Badge, Spinner } from "./ui";
import { useWorkspace } from "./workspace-context";
import { tidyPath } from "@/lib/format";
import { useApi } from "@/lib/client";
import type { GitState, InstalledSkill, McpServer, Project } from "@/lib/types";

function Block({ title, children, href }: { title: string; children: React.ReactNode; href?: string }) {
  return (
    <section className="border-b border-line py-4 first:pt-0 last:border-0">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[12.5px] font-semibold text-ink-2">{title}</h2>
        {href && (
          <Link href={href} className="text-[12px] text-ink-3 hover:text-accent">
            Open
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function ContextPanel() {
  const { project, agents } = useWorkspace();
  const pid = project?.id;
  const proj = useApi<{ project: Project; git: GitState; stack: string[] }>(pid ? `/api/projects/${pid}` : null, { interval: 10_000 });
  const skills = useApi<{ project: InstalledSkill[]; global: InstalledSkill[] }>(pid ? `/api/skills/installed?projectId=${pid}` : null);
  const mcp = useApi<{ servers: McpServer[]; error?: string }>(pid ? `/api/mcp?projectId=${pid}` : null);

  if (!project)
    return (
      <p className="text-[13px] text-ink-2">
        No project selected. <Link href="/projects" className="text-accent underline underline-offset-2">Add a local folder</Link> to see its git state, skills and tools here.
      </p>
    );

  const git = proj.data?.git;
  const ready = agents.filter((a) => a.install === "installed" && a.integration !== "out-of-scope");
  const projectSkills = skills.data?.project ?? [];
  const servers = mcp.data?.servers ?? [];

  return (
    <div>
      <Block title="Project" href="/projects">
        <p className="font-mono text-[13px] font-semibold text-ink">{project.name}</p>
        <p className="mt-0.5 truncate font-mono text-[11.5px] text-ink-3" title={project.path}>
          {tidyPath(project.path)}
        </p>
        {proj.data?.stack?.length ? <p className="mt-1.5 text-[12px] text-ink-2">{proj.data.stack.join(", ")}</p> : null}
      </Block>
      <Block title="Git">
        {!git ? (
          <Spinner className="text-ink-3" />
        ) : !git.isRepo ? (
          <p className="text-[12.5px] text-ink-2">Not a git repository. Sessions will edit the folder directly and diff review is off.</p>
        ) : (
          <>
            <p className="flex items-center gap-1.5 font-mono text-[12.5px] text-ink">
              <GitBranch size={13} aria-hidden /> {git.branch ?? "detached"}
              {git.ahead ? <span className="text-ink-3">+{git.ahead}</span> : null}
            </p>
            <p className="mt-1 text-[12px] text-ink-2">
              {git.changes.length ? `${git.changes.length} changed file${git.changes.length === 1 ? "" : "s"}` : "Working tree clean"}
              {git.worktrees.length > 1 ? `, ${git.worktrees.length - 1} worktree${git.worktrees.length === 2 ? "" : "s"}` : ""}
            </p>
            {git.changes.length > 0 && (
              <ul className="mt-2 flex max-h-40 flex-col gap-0.5 overflow-y-auto">
                {git.changes.slice(0, 30).map((c) => (
                  <li key={c.path} className="flex gap-2 font-mono text-[11.5px] text-ink-2">
                    <span className="w-4 shrink-0 text-warn">{c.status}</span>
                    <span className="truncate">{c.path}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Block>
      <Block title="Agents" href="/agents">
        <ul className="flex flex-col gap-2">
          {ready.length === 0 && <li className="text-[12.5px] text-ink-2">No agents installed.</li>}
          {ready.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <AgentMark agent={a} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{a.displayName}</span>
              <AuthBadge a={a} />
            </li>
          ))}
        </ul>
      </Block>
      <Block title="Project skills" href="/skills">
        {skills.loading && !skills.data ? (
          <Spinner className="text-ink-3" />
        ) : projectSkills.length ? (
          <ul className="flex flex-wrap gap-1">
            {projectSkills.map((s) => (
              <li key={s.name}>
                <Badge>{s.name}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-2">None installed in this project. {skills.data?.global.length ? `${skills.data.global.length} global.` : ""}</p>
        )}
      </Block>
      <Block title="MCP tools" href="/integrations">
        {mcp.loading && !mcp.data ? (
          <p className="flex items-center gap-2 text-[12px] text-ink-3">
            <Spinner /> Asking Claude Code…
          </p>
        ) : mcp.data?.error ? (
          <p className="text-[12.5px] text-ink-2">{mcp.data.error}</p>
        ) : (
          <p className="text-[12.5px] text-ink-2">
            {servers.filter((s) => s.status === "connected").length} connected, {servers.filter((s) => s.status === "needs-auth").length} need sign-in,{" "}
            {servers.filter((s) => s.status === "failed").length} failed
          </p>
        )}
      </Block>
      <p className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
        <FileDiff size={12} aria-hidden /> Agent changes land in isolated worktrees until you apply them.
      </p>
    </div>
  );
}
