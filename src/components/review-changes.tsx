"use client";

import { Wait } from "@/components/wait";
import { useEffect, useMemo, useRef, useState } from "react";
import { GitMerge, ShieldCheck, Sparkles, TriangleAlert, Users } from "lucide-react";
import { AskFriend } from "./ask-friend";
import { Button, ConfirmDialog, Drawer, cx } from "./ui";
import { api } from "@/lib/client";
import { tidyPath } from "@/lib/format";
import type { Proof, ProofItem } from "@/lib/proof-types";
import type { Session } from "@/lib/types";

/**
 * Review a session's changes before they reach the project: scope checks on every file, a
 * one-line summary per file from the local model when Ollama runs, and Apply for only the files
 * you keep. Files outside the task start unchecked.
 */

type Flag = { kind: string; text: string };
type RFile = { path: string; status: string; additions: number; deletions: number; binary: boolean; flags: Flag[]; summary?: string; related?: "yes" | "no" | "unsure" };
type ReviewResp = { files: RFile[]; engine: { kind: "rules" } | { kind: "local-model"; model: string }; note?: string; applied: string[] };
type DiffResp = { patch: string; truncated?: boolean; note?: string; isolated?: boolean; branch?: string | null; base?: string | null };

// Only the diff-based check unchecks a file; the local model's opinion is shown, not acted on.
const suspect = (f: RFile) => f.flags.some((x) => x.kind === "outside");
const doubted = (f: RFile) => f.flags.some((x) => x.kind === "unrelated");

export function PatchView({ patch, file }: { patch: string; file: string | null }) {
  const chunks = useMemo(() => {
    const out: { path: string; lines: string[] }[] = [];
    for (const line of patch.split("\n")) {
      if (line.startsWith("diff --git ")) out.push({ path: line.split(" b/").pop() ?? line, lines: [] });
      out.at(-1)?.lines.push(line);
    }
    return out;
  }, [patch]);
  const shown = file ? chunks.filter((c) => c.path === file) : chunks;
  if (!shown.length) return null;
  return (
    <div className="term overflow-x-auto rounded-[var(--radius-control)] border border-line">
      {shown.map((c) => (
        <pre key={c.path} className="min-w-max border-b border-line px-3 py-2 text-[12px] last:border-0">
          {c.lines.map((l, i) => (
            <div key={i} className={cx(l.startsWith("+") && !l.startsWith("+++") && "diff-add", l.startsWith("-") && !l.startsWith("---") && "diff-del", l.startsWith("@@") && "diff-hunk", (l.startsWith("diff ") || l.startsWith("index ")) && "text-ink-3")}>
              {l || " "}
            </div>
          ))}
        </pre>
      ))}
    </div>
  );
}

/** Does the diff back up what the agent said? Checks from src/runtime/proof.ts. */
function ProofBox({ sessionId, onFile }: { sessionId: string; onFile: (f: string) => void }) {
  const [proof, setProof] = useState<Proof | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [npm, setNpm] = useState<{ items: ProofItem[]; checked: number } | "busy" | null>(null);
  useEffect(() => {
    let off = false;
    api<Proof>(`/api/sessions/${sessionId}/proof`).then((p) => !off && setProof(p), (e: Error) => !off && setErr(e.message));
    return () => {
      off = true;
    };
  }, [sessionId]);
  if (err) return <p className="text-[12.5px] text-bad">Proof checks failed: {err}</p>;
  if (!proof) return <Wait kind="scan" small label="Checking the agent's claims" />;
  const extra = npm && npm !== "busy" ? npm.items : [];
  const items = [...proof.items, ...extra];
  const bad = items.some((i) => i.level === "bad");
  const row = (i: ProofItem, n: number) => (
    <li key={n} className="text-[13px]">
      <span className={i.level === "bad" ? "text-bad" : "text-warn"}>{i.text}</span>
      {i.file && (
        <button type="button" className="ml-1.5 font-mono text-[12px] break-all text-ink-2 underline underline-offset-2" onClick={() => onFile(i.file!)}>
          {i.file}
          {i.line ? `:${i.line}` : ""}
        </button>
      )}
    </li>
  );
  return (
    <section aria-label="Proof checks" className={cx("rounded-[var(--radius-control)] border px-3 py-2.5", bad ? "border-bad/50 bg-bad-soft" : "border-line")}>
      <p className="flex items-center gap-2 text-[13.5px] font-medium">
        {items.length ? <TriangleAlert size={15} aria-hidden className={bad ? "text-bad" : "text-warn"} /> : <ShieldCheck size={15} aria-hidden className="text-ok" />}
        {items.length ? `${items.length} thing${items.length === 1 ? "" : "s"} to check before you trust this` : "No false claims, weakened tests, secrets or unfinished code found"}
      </p>
      {items.length > 0 && <ul className="mt-1 flex flex-col gap-0.5">{items.slice(0, 4).map(row)}</ul>}
      {items.length > 4 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[12.5px] text-ink-2">{items.length - 4} more</summary>
          <ul className="mt-1 flex flex-col gap-0.5">{items.slice(4).map(row)}</ul>
        </details>
      )}
      <p className="mt-1 text-[12.5px] text-ink-2">
        {proof.evidence.length ? `Test run seen: ${proof.evidence[0]}.` : "Nexus saw no test run."} These are pattern checks, not proof the code is right.
        {proof.truncated ? " The diff was cut off, so some files were not checked." : ""}
      </p>
      {proof.newPackages.length > 0 &&
        (npm && npm !== "busy" ? (
          <p className="mt-1 text-[12.5px] text-ink-2">Checked {npm.checked} of {proof.newPackages.length} new packages on npm.</p>
        ) : (
          <Button
            size="sm"
            disabled={npm === "busy"}
            onClick={async () => {
              setNpm("busy");
              try {
                setNpm(await api(`/api/sessions/${sessionId}/proof`, { method: "POST" }));
              } catch (e) {
                setNpm(null);
                setErr((e as Error).message);
              }
            }}
          >
            {npm === "busy" ? "Checking…" : `Look up ${proof.newPackages.length} new package${proof.newPackages.length === 1 ? "" : "s"} on npm`}
          </Button>
        ))}
    </section>
  );
}

export function ReviewChanges({
  s,
  open,
  onClose,
  onChanged,
  onDiscard,
  notify,
  projectName,
}: {
  s: Session;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  onDiscard?: () => void;
  notify: (m: string) => void;
  projectName: string;
}) {
  const [diff, setDiff] = useState<DiffResp | null>(null);
  const [review, setReview] = useState<ReviewResp | null>(null);
  const [thinking, setThinking] = useState(false);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const touched = useRef(false);
  const [file, setFile] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [friend, setFriend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canApply = !!s.worktreeBranch && s.status === "completed";

  useEffect(() => {
    if (!open) return;
    let off = false;
    const pick = (r: ReviewResp) => new Set(r.files.filter((f) => !r.applied.includes(f.path) && !suspect(f)).map((f) => f.path));
    /* eslint-disable react-hooks/set-state-in-effect */
    setDiff(null);
    setReview(null);
    setFile(null);
    setErr(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    touched.current = false;
    void (async () => {
      try {
        const [d, r] = await Promise.all([api<DiffResp>(`/api/sessions/${s.id}/diff`), api<ReviewResp>(`/api/sessions/${s.id}/review`)]);
        if (off) return;
        setDiff(d);
        setReview(r);
        setKeep(pick(r));
        if (!r.files.length) return;
        setThinking(true);
        const ai = await api<ReviewResp>(`/api/sessions/${s.id}/review?ai=1`);
        if (off) return;
        setReview(ai);
        // Only reset the checkboxes if the person hasn't changed any yet.
        if (!touched.current) setKeep(pick(ai));
      } catch (e) {
        if (!off) setErr((e as Error).message);
      } finally {
        if (!off) setThinking(false);
      }
    })();
    return () => {
      off = true;
    };
  }, [open, s.id]);

  const files = review?.files ?? [];
  const applied = new Set(review?.applied ?? []);
  const remaining = files.filter((f) => !applied.has(f.path));
  const outside = remaining.filter(suspect);
  const doubts = remaining.filter((f) => !suspect(f) && doubted(f));
  const chosen = remaining.filter((f) => keep.has(f.path));

  const toggle = (p: string) => {
    touched.current = true;
    setKeep((k) => {
      const n = new Set(k);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  };

  const apply = async () => {
    setConfirm(false);
    setBusy(true);
    try {
      const all = chosen.length === remaining.length;
      const r = await api<{ files: number; partial: boolean }>(`/api/sessions/${s.id}/action`, { body: { action: "apply", confirm: true, ...(all ? {} : { files: chosen.map((f) => f.path) }) } });
      notify(r.partial ? `Applied ${r.files} file${r.files === 1 ? "" : "s"}. The rest stay in the worktree.` : "Changes applied to your project as uncommitted edits.");
      onChanged();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const engine = review?.engine;
  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={
          <div>
            <h2 className="text-[16px] font-semibold">Review changes from {s.title}</h2>
            <p className="font-mono text-[12px] text-ink-3">
              {diff?.isolated ? `Worktree ${tidyPath(s.cwd)} on ${diff.branch}, compared with ${diff.base?.slice(0, 8)}` : `Folder ${tidyPath(s.cwd)} compared with ${s.baseRef?.slice(0, 8) ?? "HEAD"}`}
            </p>
          </div>
        }
        footer={
          files.length ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {err && <p className="mr-auto max-w-sm text-[12.5px] text-bad whitespace-pre-wrap">{err}</p>}
              <Button onClick={() => setFriend(true)}>
                <Users size={14} aria-hidden /> Ask a friend
              </Button>
              {onDiscard && canApply && !applied.size && <Button onClick={onDiscard}>Discard all</Button>}
              {canApply && remaining.length > 0 && (
                <Button variant="primary" disabled={!chosen.length || busy} onClick={() => setConfirm(true)}>
                  <GitMerge size={14} aria-hidden /> {remaining.length === 1 ? "Apply 1 file" : chosen.length === remaining.length ? `Apply all ${chosen.length} files` : `Apply ${chosen.length} of ${remaining.length} files`}
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {!review || !diff ? (
          err ? <p className="text-[13px] text-bad">{err}</p> : <Wait kind="scan" className="py-12" label="Reading the changes" />
        ) : diff.note || review.note && !files.length ? (
          <p className="text-[13px] text-ink-2">{diff.note ?? review.note}</p>
        ) : !files.length ? (
          <p className="text-[13px] text-ink-2">No file changes.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className={cx("rounded-[var(--radius-control)] border px-3 py-2.5 text-[13.5px]", outside.length ? "border-warn/50 bg-warn-soft" : "border-line bg-surface-2/60")}>
              <p className="flex items-center gap-2 font-medium text-ink">
                {outside.length > 0 && <TriangleAlert size={15} className="shrink-0 text-warn" aria-hidden />}
                {outside.length
                  ? `${outside.length} of ${remaining.length} files look outside the task${canApply ? ", so they start unchecked" : ""}.`
                  : `${remaining.length} file${remaining.length === 1 ? "" : "s"} changed. Nothing looks outside the task.`}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink-2">
                <Sparkles size={13} aria-hidden className="shrink-0" />
                {thinking ? "Writing a summary of each file with the local model…" : engine?.kind === "local-model" ? `Summaries by ${engine.model} on Ollama. Other checks come from the diff.` : (review.note ?? "Checks come from the diff.")}
              </p>
              {doubts.length > 0 && <p className="mt-0.5 text-[12.5px] text-ink-2">The local model doubts {doubts.length} more. Check {doubts.length === 1 ? "it" : "them"} before you apply; {doubts.length === 1 ? "it stays" : "they stay"} checked.</p>}
              {applied.size > 0 && <p className="mt-0.5 text-[12.5px] text-ink-2">{applied.size} already applied to {projectName}.</p>}
            </div>

            <ProofBox sessionId={s.id} onFile={setFile} />

            <ul className="flex flex-col gap-1">
              {files.map((f) => {
                const done = applied.has(f.path);
                return (
                  <li key={f.path} className={cx("rounded-[var(--radius-control)] border px-2.5 py-2", file === f.path ? "border-line-strong bg-surface-2" : "border-line")}>
                    <div className="flex items-center gap-2.5">
                      {canApply && (
                        <input
                          type="checkbox"
                          checked={done || keep.has(f.path)}
                          disabled={done}
                          onChange={() => toggle(f.path)}
                          aria-label={`Apply ${f.path}`}
                          className="size-4 shrink-0 accent-[var(--accent)]"
                        />
                      )}
                      <button type="button" onClick={() => setFile(file === f.path ? null : f.path)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={file === f.path}>
                        <span className={cx("w-16 shrink-0 font-mono text-[12px]", f.status === "added" ? "text-ok" : f.status === "deleted" ? "text-bad" : "text-warn")}>{done ? "applied" : f.status}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{f.path}</span>
                        <span className="shrink-0 font-mono text-[12px] text-ok">+{f.additions}</span>
                        <span className="shrink-0 font-mono text-[12px] text-bad">-{f.deletions}</span>
                      </button>
                    </div>
                    {(f.summary || f.flags.length > 0) && (
                      <div className={cx("mt-1 flex flex-wrap items-center gap-1.5", canApply && "pl-[26px]")}>
                        {f.flags.map((x) => (
                          <span key={x.kind} className={cx("rounded-full border px-2 py-0.5 text-[12px]", x.kind === "deleted" ? "border-bad/50 text-bad" : x.kind === "unrelated" ? "border-line-strong text-ink-2" : "border-warn/50 text-warn")}>
                            {x.text}
                          </span>
                        ))}
                        {f.summary && <span className="min-w-0 text-[13px] text-ink-2">{f.summary}</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <PatchView patch={diff.patch} file={file} />
            {diff.truncated && <p className="text-[12px] text-warn">The diff is large and was cut off. Open the worktree to see everything.</p>}
          </div>
        )}
      </Drawer>
      <AskFriend s={s} open={friend} onClose={() => setFriend(false)} onChanged={onChanged} notify={notify} />
      <ConfirmDialog
        open={confirm}
        onCancel={() => setConfirm(false)}
        onConfirm={apply}
        title={chosen.length === remaining.length ? "Apply these changes to your project?" : `Apply ${chosen.length} of ${remaining.length} files?`}
        body={
          <p>
            Nexus copies {chosen.length === remaining.length ? "this session's changes" : "the checked files"} into <span className="font-mono">{projectName}</span> as uncommitted edits. It does not commit or push. If files conflict, nothing is changed.
            {chosen.length < remaining.length ? " Unchecked files stay in the worktree, so you can still apply them later." : ""}
          </p>
        }
        confirmLabel="Apply changes"
      />
    </>
  );
}
