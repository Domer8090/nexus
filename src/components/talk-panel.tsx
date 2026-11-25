"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Composer } from "./composer";
import { useApi } from "@/lib/client";
import { useSessionStream } from "@/lib/live";
import type { Session } from "@/lib/types";

type Msg = { id: number; text: string; images: number; step: string; read: boolean };

const tidy = (t: string) => t.replace(/```json[\s\S]*?(```|$)/g, "").replace(/^\s*[-*] \[[ xX?]\].*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();

/** The conversation with a run: what you said, what the agent is saying, and a place to write. */
export function TalkPanel({ workflow, current, live, name, canPoint }: { workflow: string; current: Session | undefined; live: boolean; name: string; canPoint?: boolean }) {
  const talk = useApi<{ messages: Msg[] }>(`/api/talk?workflow=${workflow}`, { interval: live ? 3000 : 15_000 });
  return (
    <section aria-label="Conversation" data-tour="talk" className="panel flex min-w-0 flex-col gap-3 p-4">
      <h2 className="text-[15px] text-ink">Talk to {name}</h2>
      {current && <Said key={current.id} session={current} messages={talk.data?.messages ?? []} />}
      <Composer workflow={workflow} live={live} name={name} canPoint={canPoint} onSent={() => void talk.reload()} />
    </section>
  );
}

function Said({ session, messages }: { session: Session; messages: Msg[] }) {
  const { events } = useSessionStream(session.id);
  const text = tidy(events.filter((e) => e.kind === "text").map((e) => e.text).join("")).slice(-1600);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, messages.length]);
  if (!text && !messages.length) return null;
  return (
    <div ref={box} className="flex max-h-80 flex-col gap-3 overflow-y-auto" role="log">
      {messages.slice(-6).map((m) => (
        <div key={m.id} className="max-w-[90%] self-end rounded-[var(--radius-dock)] bg-surface-2 px-3 py-2 text-[14px] whitespace-pre-wrap text-ink">
          {m.text.split("\n\nThe user pointed at")[0]}
          <span className="mt-1 block text-[11.5px] text-ink-3">
            {m.images ? `${m.images} picture${m.images > 1 ? "s" : ""}, ` : ""}
            {m.read ? `read in ${m.step}` : "waiting"}
          </span>
        </div>
      ))}
      {text && (
        <div className="prose-nexus !text-[14px]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
