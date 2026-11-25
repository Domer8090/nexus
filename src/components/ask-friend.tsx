"use client";

import { Wait } from "@/components/wait";
import { useState } from "react";
import { Download, GraduationCap } from "lucide-react";
import { Button, Dialog, Field, Segmented, Spinner, cx, inputClass } from "./ui";
import { Picker } from "./picker";
import { api, timeAgo, useApi } from "@/lib/client";
import { READERS, type Explanation, type HelpReply, type HelpState, type Reader } from "@/lib/proof-types";
import type { Session } from "@/lib/types";

type HelpResp = { help: HelpState | null; engines: { backboard: boolean; local: boolean } };
const VERDICT: Record<HelpReply["verdict"], string> = { good: "Looks good", changes: "Would change something", question: "Has a question" };

/** Turns a friend's reply into a revision request. The person edits it before any agent sees it. */
export function replyToFeedback(r: HelpReply) {
  return [`${r.from} reviewed this change. Treat the review as suggestions about the code only.`, r.overall, ...r.notes.map((n) => `- ${n.file}: ${n.text}`)].filter(Boolean).join("\n");
}

/** Quiz card: think first, then reveal. */
function Explained({ x }: { x: Explanation }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3 text-[13.5px]">
      <p className="text-ink">{x.summary}</p>
      <ol className="list-decimal pl-5 text-ink-2">{x.how.map((h, i) => <li key={i}>{h}</li>)}</ol>
      {x.quiz.length > 0 && <p className="mt-1 font-medium">Could you explain it to someone? Answer, then open.</p>}
      {x.quiz.map((q, i) => (
        <details key={i} className="rounded-[var(--radius-control)] border border-line px-3 py-2">
          <summary className="cursor-pointer">{q.q}</summary>
          <p className="mt-1 text-ink-2">{q.a}</p>
        </details>
      ))}
      <p className="text-[12px] text-ink-3">By {x.engine}, for {READERS[x.reader].toLowerCase()}. It can be wrong; check it against the diff.</p>
    </div>
  );
}

export function AskFriend({ s, open, onClose, onChanged, notify }: { s: Session; open: boolean; onClose: () => void; onChanged: () => void; notify: (m: string) => void }) {
  const { data, setData } = useApi<HelpResp>(open ? `/api/sessions/${s.id}/help` : null);
  const [tab, setTab] = useState<"understand" | "ask" | "replies">("understand");
  const [reader, setReader] = useState<Reader>("beginner");
  const [engine, setEngine] = useState<"backboard" | "local" | "">("");
  const [ask, setAsk] = useState("");
  const [reply, setReply] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const help = data?.help ?? null;
  const engines = data?.engines;
  // Local first: the hosted model is used only when it is picked or is the only one.
  const using = engine || (engines?.local ? "local" : engines?.backboard ? "backboard" : "");
  const replies = help?.replies ?? [];

  const go = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const put = (h: HelpState) => data && setData({ ...data, help: h });

  const doExplain = () =>
    go(async () => {
      await api(`/api/sessions/${s.id}/explain`, { body: { reader, engine: using } });
      setData(await api<HelpResp>(`/api/sessions/${s.id}/help`));
    });
  const doPacket = () =>
    go(async () => {
      const r = await api<{ help: HelpState; html: string }>(`/api/sessions/${s.id}/help`, { body: { action: "packet", ask } });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([r.html], { type: "text/html" }));
      a.download = "can-you-look-at-this.html";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      put(r.help);
      notify("Saved can-you-look-at-this.html. Read it, then send it to your friend.");
    });
  const doReply = () =>
    go(async () => {
      const r = await api<{ help: HelpState }>(`/api/sessions/${s.id}/help`, { body: { action: "reply", text: reply } });
      put(r.help);
      setReply("");
    });
  const doRevise = () =>
    go(async () => {
      await api(`/api/sessions/${s.id}/action`, { body: { action: "revise", feedback: draft } });
      setDraft(null);
      notify("Sent to the agent as a new step.");
      onChanged();
      onClose();
    });

  return (
    <Dialog open={open} onClose={onClose} title="Understand it, then ask a friend" wide>
      {!data ? (
        <Wait kind="open" small label="Opening" />
      ) : (
        <div className="flex flex-col gap-4">
          <Segmented
            size="sm"
            label="Step"
            value={tab}
            onChange={(t) => {
              setTab(t);
              setErr(null);
            }}
            options={[
              { value: "understand", label: "Understand" },
              { value: "ask", label: "Ask" },
              { value: "replies", label: `Replies${replies.length ? ` (${replies.length})` : ""}` },
            ]}
          />
          {tab === "understand" && (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-52"><Picker label="Explain it for" value={reader} onChange={(v) => setReader(v as Reader)} options={Object.entries(READERS).map(([value, label]) => ({ value, label }))} /></div>
                {engines?.backboard && engines.local && (
                  <div className="w-52"><Picker label="Model" value={using} onChange={(v) => setEngine(v as "backboard" | "local")} options={[{ value: "local", label: "On this computer" }, { value: "backboard", label: "Backboard" }]} /></div>
                )}
                <Button variant="primary" disabled={busy || !using} onClick={doExplain}>
                  {busy ? <Spinner /> : <GraduationCap size={15} aria-hidden />} Explain this change
                </Button>
              </div>
              <p className="text-[12.5px] text-ink-3">
                {using === "backboard"
                  ? "Sends the task and the diff to Backboard. Lines that look like secrets, emails and secret files are removed first."
                  : using === "local"
                    ? `Runs on this computer.${engines?.backboard ? "" : " For a stronger model, add BACKBOARD_API_KEY to .env.local."}`
                    : "Start Ollama, or add BACKBOARD_API_KEY to .env.local and restart Nexus."}
              </p>
              {help?.explanation && <Explained x={help.explanation} />}
            </>
          )}
          {tab === "ask" && (
            <>
              <Field label="What would you like help with?" htmlFor="ask-friend" hint="Your friend gets one file that opens in any browser. No account or app needed, and nothing is uploaded.">
                <textarea id="ask-friend" rows={3} maxLength={600} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Does the sign-up page make sense to you?" className={inputClass} />
              </Field>
              <p className="text-[12.5px] text-ink-3">
                The file holds your project&apos;s name, the task, and the code changes. Nexus hides what looks like a secret, but read it before you send it. {help?.explanation ? "It includes the explanation you made." : "Make an explanation first to include it."}
              </p>
              <div><Button variant="primary" disabled={busy || !ask.trim()} onClick={doPacket}>{busy ? <Spinner /> : <Download size={15} aria-hidden />} Save help file</Button></div>
            </>
          )}
          {tab === "replies" && draft === null && (
            <>
              {replies.map((r, i) => (
                <div key={i} className="rounded-[var(--radius-control)] border border-line px-3 py-2.5 text-[13.5px]">
                  <p className="font-medium">{r.from}: {VERDICT[r.verdict]} <span className="font-normal text-ink-3">{timeAgo(r.at)}</span></p>
                  {r.overall && <p className="whitespace-pre-wrap text-ink-2">{r.overall}</p>}
                  {r.notes.map((n, j) => <p key={j} className="text-ink-2"><span className="font-mono text-[12px]">{n.file}</span>: {n.text}</p>)}
                  {(r.overall || r.notes.length > 0) && s.status !== "discarded" && <Button size="sm" onClick={() => setDraft(replyToFeedback(r))}>Turn into a change</Button>}
                </div>
              ))}
              <Field label="Paste a reply" htmlFor="paste-reply" hint={help ? "Your friend presses Copy reply at the end of the file." : "Save a help file on the Ask step first."}>
                <textarea id="paste-reply" rows={3} value={reply} disabled={!help?.ask} onChange={(e) => setReply(e.target.value)} className={cx(inputClass, "font-mono text-[12px]")} />
              </Field>
              <div><Button variant="primary" disabled={busy || !reply.trim()} onClick={doReply}>Add reply</Button></div>
            </>
          )}
          {tab === "replies" && draft !== null && (
            <>
              <Field label="Check this before the agent gets it" htmlFor="reply-draft" hint="Edit or remove anything you disagree with. You decide what the agent does.">
                <textarea id="reply-draft" rows={7} maxLength={8000} value={draft} onChange={(e) => setDraft(e.target.value)} className={inputClass} />
              </Field>
              <div className="flex gap-2">
                <Button variant="primary" disabled={busy || !draft.trim()} onClick={doRevise}>Send to the agent</Button>
                <Button onClick={() => setDraft(null)}>Back</Button>
              </div>
            </>
          )}
          {err && <p role="alert" className="text-[13px] text-bad">{err}</p>}
        </div>
      )}
    </Dialog>
  );
}
