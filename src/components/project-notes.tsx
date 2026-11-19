"use client";

import { useEffect, useState } from "react";
import { Button, Dialog, cx } from "./ui";
import { api } from "@/lib/client";

/**
 * Project notes: rules and decisions every new session in this project gets, so you stop
 * explaining the same things. Stored by Nexus, not in the project.
 */
export function ProjectNotes({ projectId, projectName, open, onClose, dark }: { projectId: string | null; projectName: string; open: boolean; onClose: () => void; dark?: boolean }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "saving">("loading");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !projectId) return;
    let off = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState("loading");
    setErr(null);
    api<{ text: string }>(`/api/projects/${projectId}/notes`)
      .then((n) => {
        if (off) return;
        setText(n.text);
        setSaved(n.text);
        setState("ready");
      })
      .catch((e: Error) => {
        if (!off) setErr(e.message);
      });
    return () => {
      off = true;
    };
  }, [open, projectId]);

  const save = async () => {
    if (!projectId) return;
    setState("saving");
    try {
      const n = await api<{ text: string }>(`/api/projects/${projectId}/notes`, { method: "PUT", body: { text } });
      setSaved(n.text);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setState("ready");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Notes for ${projectName}`}
      wide
      footer={
        <div className="flex items-center justify-end gap-2">
          {err && <p className="mr-auto text-[13px] text-bad">{err}</p>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!projectId || state !== "ready" || text === saved}>
            Save notes
          </Button>
        </div>
      }
    >
      {!projectId ? (
        <p className="text-[14px] text-ink-2">Pick a project in the menu first.</p>
      ) : (
        <>
          <p className="mb-2 text-[14px] text-ink-2">Every new step in this project gets these notes, so you say things once.</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={state === "loading"}
            rows={12}
            maxLength={8000}
            aria-label={`Notes for ${projectName}`}
            placeholder={"- Use Tailwind, not plain CSS files\n- Don't touch the checkout flow\n- We chose SQLite on purpose; keep it"}
            className={cx("w-full resize-y rounded-[var(--radius-control)] border border-line px-3 py-2.5 font-mono text-[14px] leading-relaxed text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none", dark ? "bg-[#0b0b0b]" : "bg-canvas")}
          />
          <p className="mt-1 text-right font-mono text-[12px] text-ink-3">{text.length} / 8000</p>
        </>
      )}
    </Dialog>
  );
}
