"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, MessageCircleQuestion } from "lucide-react";
import { Button, cx, inputClass } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import type { AskState } from "@/lib/ask-types";

/**
 * "Nexus has a few questions": a side panel that never holds up the work. One question at a time;
 * while it is answered, the local model prepares the next ones and agents add what they are stuck on.
 */
export function QuestionDock({ id, goal, kind, live, floating }: { id: string; goal?: string; kind: "hackathon" | "run"; live: boolean; floating?: boolean }) {
  const ask = useApi<AskState>(`/api/ask?id=${encodeURIComponent(id)}`, { interval: live ? 2500 : 10_000 });
  const { setData, reload } = ask;
  const [own, setOwn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!floating);
  const seeded = useRef("");
  useEffect(() => {
    const k = `${id}:${goal ?? ""}`;
    if (!live || seeded.current === k) return;
    const t = window.setTimeout(() => {
      seeded.current = k;
      api<AskState>("/api/ask", { body: { action: "seed", id, goal: goal ?? "", kind } }).then(setData).catch(() => {});
    }, kind === "hackathon" && goal ? 1200 : 0);
    return () => window.clearTimeout(t);
  }, [id, goal, kind, live, setData]);

  const all = ask.data?.questions ?? [];
  // What an agent is stuck on comes first.
  const waiting = all.filter((q) => q.answer === null && !q.skipped).sort((a, b) => Number(b.source === "agent") - Number(a.source === "agent"));
  // Keep the question on screen while it is being answered, even if a more urgent one arrives.
  const [held, setHeld] = useState<string | null>(null);
  const q = waiting.find((x) => x.id === held) ?? waiting[0];
  const answered = all.filter((x) => x.answer).length;
  // Gone once there is nothing to answer, or nobody left to use the answers.
  if ((!live || !waiting.length) && !ask.data?.canApply) return null;

  const send = async (action: "answer" | "apply", text?: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<AskState>("/api/ask", { body: action === "apply" ? { action, id } : { action, id, question: q!.id, text } });
      setData(r);
      setOwn("");
      setHeld(null);
      if (action === "apply") await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const head = (
    <>
      <MessageCircleQuestion size={18} className="shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 text-left text-[15px] text-ink">{waiting.length ? "Nexus has a few questions" : "Your answers are in"}</span>
      {waiting.length > 0 && <span className="tabular rounded-full bg-ink px-2 py-0.5 font-mono text-[11px] text-canvas">{waiting.length}</span>}
    </>
  );
  return (
    <section data-tour="questions" aria-label="Nexus has a few questions" className={cx("flex min-w-0 flex-col border border-line", floating ? "force-dark fixed right-4 bottom-4 z-40 max-h-[80vh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-[var(--radius-dock)] bg-surface text-ink shadow-2xl" : "panel")}>
      {floating ? (
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-2.5 p-4">
          {head}
          <ChevronDown size={16} className={cx("transition-transform", !open && "rotate-180")} aria-hidden />
        </button>
      ) : (
        <div className="flex items-center gap-2.5 p-4">{head}</div>
      )}
      {open && (
        <div className="border-t border-line p-4">
          {q && live ? (
            <div key={q.id} className="rise-in flex flex-col gap-3">
              {q.source === "agent" && <p className="text-[12px] text-warn">The agent got stuck here: {q.from}</p>}
              <p className="text-[18px] leading-snug text-ink">{q.text}</p>
              <div className="flex flex-col gap-2" role="group" aria-label={q.text}>
                {q.options.map((o) => (
                  <button key={o} type="button" disabled={busy} onClick={() => send("answer", o)} className="btn-step rounded-[var(--radius-control)] border border-line px-3 py-2.5 text-left text-[14px] text-ink hover:border-line-strong hover:bg-surface-2">
                    {o}
                  </button>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (own.trim()) void send("answer", own.trim());
                }}
              >
                <input aria-label="Your own answer" value={own} onFocus={() => setHeld(q.id)} onChange={(e) => setOwn(e.target.value)} maxLength={600} placeholder="Type your own" className={inputClass} />
                <Button type="submit" size="sm" aria-label="Send answer" className="!h-auto" disabled={busy || !own.trim()}>
                  <ArrowRight size={15} aria-hidden />
                </Button>
              </form>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => send("answer", null)}>
                  Skip
                </Button>
                <span className="ml-auto text-[12px] text-ink-3">{ask.data?.generating ? "Thinking of more…" : answered ? `${answered} answered` : "Building doesn't wait for these"}</span>
              </div>
            </div>
          ) : null}
          {ask.data?.canApply && (
            <Button variant="primary" className="mt-3 w-full" disabled={busy} onClick={() => send("apply")}>
              Update the build with my answers
            </Button>
          )}
          {error && (
            <p role="alert" className="mt-2 text-[13px] text-bad">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
