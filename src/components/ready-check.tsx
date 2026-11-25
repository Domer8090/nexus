"use client";

import { useState } from "react";
import { Check, Circle, Copy } from "lucide-react";
import { Wait } from "@/components/wait";
import { Button, cx, inputClass } from "./ui";
import { api, useApi } from "@/lib/client";
import type { ReadyItem } from "@/lib/ready";

/** What is still missing before submitting, checked on this Mac. */
export function ReadyCheck({ live }: { live: boolean }) {
  const r = useApi<{ items: ReadyItem[]; unsaved: number; log: string }>("/api/hackathon/ready", { interval: live ? 10_000 : 20_000 });
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState<string | null>(null);
  if (!r.data) return r.error ? <p className="text-bad">{r.error}</p> : <Wait kind="scan" className="py-8" label="Checking what a judge would need" />;
  const { items, unsaved, log } = r.data;
  const left = items.filter((i) => !i.ok);
  const commit = async () => {
    try {
      await api("/api/hackathon/ready", { body: { action: "commit", message: msg.trim(), confirm: true } });
      setMsg("");
      setNote("Committed on this Mac. Nothing was pushed.");
      await r.reload();
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[16px] text-ink">{left.length ? `${left.length} of ${items.length} still need you or an agent.` : "Everything Nexus can check is there."}</p>
      <ul className="grid gap-x-6 gap-y-3 md:grid-cols-2">
        {[...left, ...items.filter((i) => i.ok)].map((i) => (
          <li key={i.id} className="flex items-start gap-2.5">
            {i.ok ? <Check size={17} className="mt-0.5 shrink-0 text-ok" aria-label="Done" /> : <Circle size={17} className="mt-0.5 shrink-0 text-warn" aria-label="Missing" />}
            <span>
              <span className={cx("block text-[14px]", i.ok ? "text-ink-2" : "text-ink")}>{i.label}</span>
              {!i.ok && <span className="block text-[13px] text-ink-2">{i.fix}</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {unsaved > 0 && (
          <form
            className="flex min-w-0 flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void commit();
            }}
          >
            <input aria-label="What changed" className={inputClass} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={120} placeholder="What changed, in your words" />
            <Button type="submit" disabled={msg.trim().length < 3}>
              Commit {unsaved} files
            </Button>
          </form>
        )}
        <Button
          onClick={() =>
            navigator.clipboard
              .writeText(log)
              .then(() => setNote("Copied."))
              .catch(() => setNote("Copying was blocked."))
          }
        >
          <Copy size={14} aria-hidden /> Copy the AI-use record
        </Button>
      </div>
      {note && (
        <p role="status" className="text-[13px] text-ink-2">
          {note}
        </p>
      )}
    </div>
  );
}
