"use client";

import Link from "next/link";
import { useState } from "react";
import { Bookmark, Play, Search } from "lucide-react";
import { SessionBadge } from "@/components/agent-bits";
import { EmptyState, PageHeader, Segmented, Spinner, cx, inputClass } from "@/components/ui";
import { useWorkspace } from "@/components/workspace-context";
import { timeAgo, useApi, usePref } from "@/lib/client";
import type { Session, Workflow } from "@/lib/types";

export function RunsView() {
  const { projects } = useWorkspace();
  const [filter, setFilter] = usePref<"all" | "saved" | "active">("runsFilter", "all");
  const { data, loading, error } = useApi<{ workflows: (Workflow & { sessions: Session[] })[] }>("/api/workflows", { interval: 4000 });
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const items = (data?.workflows ?? []).filter((w) => {
    if (filter === "saved" && !w.saved) return false;
    if (filter === "active" && !w.sessions.some((s) => ["running", "starting", "queued"].includes(s.status))) return false;
    if (!words.length) return true;
    const hay = [w.name, w.brief, w.preset, projects.find((p) => p.id === w.projectId)?.name ?? "", ...w.sessions.flatMap((s) => [s.title, s.agentId, s.status, s.summary ?? ""])].join(" ").toLowerCase();
    return words.every((x) => hay.includes(x));
  });
  return (
    <div className="w-full">
      <PageHeader
        title="Runs" pixel="Runs" heading="Every workflow you started"
        actions={
          <Segmented
            size="sm"
            label="Filter runs"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
              { value: "saved", label: "Saved" },
            ]}
          />
        }
      />
      <div className="relative mb-4">
        <Search size={18} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <label htmlFor="runs-q" className="sr-only">
          Search your runs
        </label>
        <input id="runs-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your runs" className={cx(inputClass, "h-12 pl-11 text-[16px]")} />
      </div>
      {error && <p className="mb-3 text-bad">{error}</p>}
      {loading && !data ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Play size={28} />}
          title={q ? `No runs match “${q}”` : filter === "all" ? "No runs yet" : "Nothing here"}
          body={q ? "Try other words, or clear the search." : filter === "all" ? "Start one in the Playground. Each run shows its agents, live output and changed files here." : "Change the filter to see other runs."}
          action={
            filter === "all" && !q ? (
              <Link href="/playground" className="btn-step inline-flex h-[34px] items-center rounded-[var(--radius-control)] border border-accent bg-accent px-3.5 font-mono text-[12px] font-medium tracking-[0.04em] text-accent-ink hover:bg-accent-hover">
                Open the Playground
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="panel divide-y divide-line" aria-label="Runs">
          {items.map((w) => (
            <li key={w.id}>
              <Link href={`/runs/${w.id}`} className="flex flex-col gap-3 px-5 py-4 hover:bg-surface-2/50">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[17px] font-medium text-ink">
                    {w.saved && <Bookmark size={15} className="shrink-0 text-accent" fill="currentColor" aria-label="Saved" />}
                    <span className="min-w-0 flex-1 truncate">{w.name}</span>
                    <span className="shrink-0 text-[14px] font-normal text-ink-2">{timeAgo(w.createdAt)}</span>
                  </p>
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {w.sessions
                    .slice()
                    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                    .map((s) => (
                      <li key={s.id} className="flex items-center gap-1.5 text-[14px] text-ink-2">
                        <span>{s.title}</span>
                        <SessionBadge status={s.status} readOnly={!s.permissions.editFiles} />
                      </li>
                    ))}
                </ul>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
