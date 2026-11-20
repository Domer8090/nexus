"use client";

import { useState } from "react";
import { ChevronRight, CornerLeftUp, FolderGit2, FolderOpen, Folder } from "lucide-react";
import { Badge, Button, Dialog, Spinner, cx, inputClass } from "./ui";
import { api, useApi } from "@/lib/client";
import { tidyPath } from "@/lib/format";
import type { Project } from "@/lib/types";

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
