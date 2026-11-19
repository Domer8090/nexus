"use client";

import { useState } from "react";
import { ChevronRight, CornerLeftUp, FileText, FolderGit2, FolderOpen, Folder, GitBranch, Trash2 } from "lucide-react";
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, PageHeader, Spinner, Toast, cx, inputClass } from "@/components/ui";
import { useWorkspace } from "@/components/workspace-context";
import { api, timeAgo, useApi } from "@/lib/client";
import { tidyPath } from "@/lib/format";
import type { GitState, Project } from "@/lib/types";

type Browse = { path: string; parent: string | null; entries: { name: string; path: string; isRepo: boolean }[] };

export function FolderPicker({ open, onClose, onPicked }: { open: boolean; onClose: () => void; onPicked: (p: Project) => void }) {
  const [dir, setDir] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const b = useApi<Browse>(open ? `/api/fs/browse?path=${encodeURIComponent(dir)}` : null);

  const add = async (p: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ project: Project }>("/api/projects", { body: { path: p } });
      onPicked(r.project);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Choose a project folder"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!b.data || busy} onClick={() => b.data && add(b.data.path)}>
            {busy ? <Spinner /> : <FolderOpen size={15} aria-hidden />} Use this folder
          </Button>
        </>
      }
    >
      <p className="mb-3">Nexus reads folders inside your home folder only. It does not upload anything.</p>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) add(typed.trim());
        }}
      >
        <label htmlFor="typed-path" className="sr-only">
          Folder path
        </label>
        <input id="typed-path" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="~/code/my-app" className={cx(inputClass, "font-mono text-[12.5px]")} />
        <Button type="submit" disabled={!typed.trim() || busy}>
          Add path
        </Button>
      </form>
      {error && (
        <p role="alert" className="mb-3 rounded bg-bad-soft px-3 py-2 text-[13px] text-bad">
          {error}
        </p>
      )}
      <div className="rounded-[var(--radius-control)] border border-line">
        <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2 font-mono text-[12px] text-ink">
          {b.data?.parent && (
            <button type="button" aria-label="Up one folder" onClick={() => setDir(b.data!.parent!)} className="rounded p-0.5 hover:bg-surface">
              <CornerLeftUp size={14} />
            </button>
          )}
          <span className="truncate">{b.data ? tidyPath(b.data.path) : "…"}</span>
        </div>
        <ul className="max-h-72 overflow-y-auto">
          {b.loading && !b.data && (
            <li className="px-3 py-3">
              <Spinner />
            </li>
          )}
          {b.error && <li className="px-3 py-3 text-bad">{b.error}</li>}
          {b.data?.entries.map((e) => (
            <li key={e.path}>
              <button type="button" onClick={() => setDir(e.path)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2">
                {e.isRepo ? <FolderGit2 size={15} className="text-accent" aria-hidden /> : <Folder size={15} className="text-ink-3" aria-hidden />}
                <span className="flex-1 truncate">{e.name}</span>
                {e.isRepo && <Badge>git</Badge>}
                <ChevronRight size={14} className="text-ink-3" aria-hidden />
              </button>
            </li>
          ))}
          {b.data && !b.data.entries.length && <li className="px-3 py-3 text-ink-3">No subfolders.</li>}
        </ul>
      </div>
    </Dialog>
  );
}

const POINTER = "Read NEXUS_MAP.md first: it lists every file with its size and the names it defines. Open only the files you need instead of exploring folders.";

/** Preview and write the one-file project map for agents you run yourself. */
function MapDialog({ p, open, onClose }: { p: Project; open: boolean; onClose: () => void }) {
  const m = useApi<{ text: string; files: number; bytes: number; truncated: boolean; file: string }>(open ? `/api/projects/${p.id}/map` : null);
  const [state, setState] = useState<string | null>(null);
  return (
    <Dialog open={open} onClose={onClose} title="Project map" wide>
      <p className="text-[13px] text-ink-2">
        One file that lists every source file with its line count and the names it defines. Agents read it once instead of listing folders and opening files to find their way. Nexus already writes it into every session&apos;s worktree; write it here to use it in your own Claude Code or Codex sessions.
      </p>
      {!m.data ? (
        <Spinner />
      ) : (
        <>
          <p className="mt-2 font-mono text-[12px] text-ink-3">
            {m.data.file}: {m.data.files} files, {(m.data.bytes / 1024).toFixed(1)} KB{m.data.truncated ? ", cut off at 48 KB" : ""}
          </p>
          <pre className="term mt-2 max-h-72 overflow-auto rounded-[var(--radius-control)] border border-line p-2 text-[11.5px] whitespace-pre-wrap text-ink-2">{m.data.text}</pre>
        </>
      )}
      <p className="mt-3 text-[12.5px] text-ink-2">To make Claude Code and Codex use it, add this line to CLAUDE.md and AGENTS.md:</p>
      <code className="term mt-1 block rounded border border-line px-2 py-1.5 text-[12px] text-ink">{POINTER}</code>
      {state && <p className="mt-2 text-[12.5px] text-ink">{state}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(POINTER).then(() => setState("Line copied."))}>
          Copy line
        </Button>
        <Button
          variant="primary"
          disabled={!m.data}
          onClick={async () => {
            try {
              const r = await api<{ path: string; files: number }>(`/api/projects/${p.id}/map`, { body: { confirm: true } });
              setState(`Wrote ${tidyPath(r.path)} (${r.files} files). It is listed in .git/info/exclude, so git ignores it.`);
            } catch (e) {
              setState((e as Error).message);
            }
          }}
        >
          Write {m.data?.file ?? "map"} to project
        </Button>
      </div>
    </Dialog>
  );
}

function ProjectCard({ p, active, onSelect, onRemove }: { p: Project; active: boolean; onSelect: () => void; onRemove: () => void }) {
  const d = useApi<{ git: GitState; stack: string[]; scripts: string[] }>(`/api/projects/${p.id}`);
  const g = d.data?.git;
  const [mapOpen, setMapOpen] = useState(false);
  return (
    <li className={cx("flex flex-col p-4", active && "bg-surface-2/40")}>
      <div className="flex items-start gap-3">
        <FolderGit2 size={20} className={active ? "text-accent" : "text-ink-3"} aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="font-mono text-[14px] font-semibold text-ink">{p.name}</h3>
          <p className="truncate font-mono text-[11.5px] text-ink-3" title={p.path}>
            {tidyPath(p.path)}
          </p>
        </div>
        {active && <Badge tone="accent">Current</Badge>}
      </div>
      <div className="mt-3 text-[12.5px] text-ink-2">
        {!g ? (
          <Spinner />
        ) : g.isRepo ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1 font-mono">
              <GitBranch size={12} aria-hidden /> {g.branch ?? "detached"}
            </span>
            <span>{g.changes.length ? `${g.changes.length} uncommitted` : "clean"}</span>
            {g.worktrees.length > 1 && <span>{g.worktrees.length - 1} Nexus/other worktrees</span>}
          </p>
        ) : (
          <p>Not a git repo: no isolation or diff review.</p>
        )}
        {d.data?.stack.length ? <p className="mt-1">{d.data.stack.join(", ")}</p> : null}
        {d.data?.scripts.length ? <p className="mt-1 font-mono text-[11.5px] text-ink-3">checks: {d.data.scripts.join(", ")}</p> : null}
      </div>
      <p className="mt-2 text-[11.5px] text-ink-3">Opened {timeAgo(p.lastOpenedAt)}</p>
      <div className="mt-3 flex gap-1.5">
        {!active && (
          <Button size="sm" variant="primary" onClick={onSelect}>
            Make current
          </Button>
        )}
        {g?.isRepo && (
          <Button size="sm" variant="ghost" onClick={() => setMapOpen(true)}>
            <FileText size={14} aria-hidden /> Project map
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${p.name} from Nexus`}>
          <Trash2 size={14} aria-hidden /> Remove
        </Button>
      </div>
      <MapDialog p={p} open={mapOpen} onClose={() => setMapOpen(false)} />
    </li>
  );
}

export function ProjectsView() {
  const { projects, project, setProjectId, reloadProjects } = useWorkspace();
  const [picker, setPicker] = useState(false);
  const [confirm, setConfirm] = useState<Project | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Projects" pixel="Projects" heading="Local folders your agents work in"
        sub="Every session gets its own git worktree. Its changes stay there until you review the diff and apply it."
        actions={
          <Button variant="primary" onClick={() => setPicker(true)}>
            <FolderOpen size={15} aria-hidden /> Add folder
          </Button>
        }
      />
      {projects.length === 0 ? (
        <EmptyState
          icon={<FolderGit2 size={28} />}
          title="No projects yet"
          body="Pick a folder on this machine. A git repository gets isolated worktrees and diff review."
          action={
            <Button variant="primary" onClick={() => setPicker(true)}>
              Choose a folder
            </Button>
          }
        />
      ) : (
        <ul className="panel divide-y divide-line" aria-label="Projects">
          {projects.map((p) => (
            <ProjectCard key={p.id} p={p} active={p.id === project?.id} onSelect={() => setProjectId(p.id)} onRemove={() => setConfirm(p)} />
          ))}
        </ul>
      )}
      <FolderPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPicked={async (p) => {
          setPicker(false);
          await reloadProjects();
          setProjectId(p.id);
          setToast(`Added ${p.name}`);
          window.setTimeout(() => setToast(null), 2000);
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm) await api(`/api/projects/${confirm.id}`, { method: "DELETE" });
          setConfirm(null);
          reloadProjects();
        }}
        title="Remove from Nexus?"
        body={<p>“{confirm?.name}” is removed from the Nexus list only. Files on disk are not touched.</p>}
        confirmLabel="Remove project"
        danger
      />
      <Toast message={toast} />
    </div>
  );
}
