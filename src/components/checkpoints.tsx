"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { Button, ConfirmDialog, Dialog } from "./ui";
import { api, timeAgo, useApi } from "@/lib/client";

type Cp = { id: string; label: string; at: string };

/** Every step leaves a restore point. Going back saves the present first, so it can be undone. */
export function Checkpoints({ workflow, live, onRestored }: { workflow: string; live: boolean; onRestored: () => void }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<Cp | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useApi<{ checkpoints: Cp[] }>(open ? `/api/checkpoints?workflow=${workflow}` : null);
  const act = async (action: "save" | "restore", id?: string) => {
    setBusy(true);
    setError(null);
    try {
      list.setData(await api("/api/checkpoints", { body: { workflow, action, id, confirm: true } }));
      if (action === "restore") onRestored();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setAsk(null);
    }
  };
  const cps = list.data?.checkpoints ?? [];
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <History size={14} aria-hidden /> Go back
      </Button>
      <Dialog
        open={open && !ask}
        onClose={() => !ask && setOpen(false)}
        title="Go back to a version that worked"
        footer={
          <Button variant="primary" disabled={busy} onClick={() => act("save")}>
            Save this version
          </Button>
        }
      >
        {error && (
          <p role="alert" className="mb-3 text-bad">
            {error}
          </p>
        )}
        {cps.length ? (
          <ul className="divide-y divide-line">
            {cps.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{c.label}</span>
                  <span className="text-[12px] text-ink-3">{timeAgo(c.at)}</span>
                </span>
                <Button size="sm" disabled={busy || live} onClick={() => setAsk(c)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p>{list.loading ? "Loading…" : "The first one is saved when a step finishes."}</p>
        )}
        {live && cps.length > 0 && <p className="mt-3">Stop the agents to restore.</p>}
      </Dialog>
      <ConfirmDialog
        open={!!ask}
        onCancel={() => setAsk(null)}
        onConfirm={() => ask && act("restore", ask.id)}
        title="Put the project back?"
        body={<p>Files go back to &ldquo;{ask?.label}&rdquo;. The version you have now is saved first, so you can return to it. Ignored files and .env files are not touched.</p>}
        confirmLabel="Restore"
      />
    </>
  );
}
