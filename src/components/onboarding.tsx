"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { NexusMark } from "./logo";
import { Button, cx } from "./ui";
import { useWorkspace } from "./workspace-context";
import { MODE_INFO, UI_MODES, modeHome, recommendMode, type Profile, type UiMode } from "@/lib/modes";

type Q = { key: keyof Profile; text: string; options: { value: string; label: string; body: string }[] };
const QUESTIONS: Q[] = [
  {
    key: "level",
    text: "How much have you coded?",
    options: [
      { value: "new", label: "I'm new to it", body: "Little or none so far" },
      { value: "some", label: "Some", body: "I can follow and change code" },
      { value: "comfortable", label: "A lot", body: "I build things on my own" },
    ],
  },
  {
    key: "goal",
    text: "What are you here to do?",
    options: [
      { value: "make", label: "Make something new", body: "A site, an app or a game" },
      { value: "existing", label: "Work on code I have", body: "Fix it or add to it" },
      { value: "hackathon", label: "Win a hackathon", body: "Build and submit by a deadline" },
    ],
  },
  {
    key: "detail",
    text: "How much do you want to see?",
    options: [
      { value: "result", label: "The result", body: "Simple steps and plain words" },
      { value: "everything", label: "Everything", body: "Files, commands and terminals" },
    ],
  },
];

/** First-run questions. They suggest a mode; the person makes the final choice. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { patchSettings } = useWorkspace();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Partial<Profile>>({});
  const [mode, setMode] = useState<UiMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);
  const q = QUESTIONS[step];
  const suggested = a.level && a.goal && a.detail ? recommendMode(a as Profile) : "beginner";
  const chosen = mode ?? suggested;
  const finish = async (m: UiMode, profile?: Profile) => {
    setBusy(true);
    try {
      await patchSettings({ mode: m, onboarded: true, ...(profile ? { profile } : {}) });
      router.push(modeHome(m));
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <dialog ref={ref} aria-labelledby="onb-title" onCancel={(e) => e.preventDefault()} className="force-dark m-0 h-dvh max-h-none w-dvw max-w-none overflow-y-auto bg-black p-0 text-ink">
      <div className="mx-auto flex min-h-full max-w-3xl flex-col px-5 py-6 sm:px-8">
        <div className="flex items-center gap-3">
          <NexusMark className="size-7" />
          <span className="flex-1 font-mono text-[13px] text-ink-2">
            {step + 1} of {QUESTIONS.length + 1}
          </span>
          <Button variant="ghost" disabled={busy} onClick={() => finish("beginner")}>
            Skip
          </Button>
        </div>
        <div className="flex flex-1 flex-col justify-center py-10">
          <h1 id="onb-title" className="font-display text-[36px] leading-[1.05] sm:text-[54px]">
            {q ? q.text : "Choose how Nexus looks"}
          </h1>
          {q ? (
            <div className="mt-10 grid gap-3" role="group" aria-labelledby="onb-title">
              {q.options.map((o) => {
                const on = a[q.key] === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setA((x) => ({ ...x, [q.key]: o.value }));
                      setMode(null);
                      setStep(step + 1);
                    }}
                    className={cx("btn-step flex min-h-16 items-center gap-4 rounded-[var(--radius-panel)] border px-5 py-3 text-left", on ? "border-ink bg-surface-2" : "border-line-strong hover:bg-surface-2")}
                  >
                    <span className="flex-1">
                      <span className="block text-[18px]">{o.label}</span>
                      <span className="block text-[14px] text-ink-2">{o.body}</span>
                    </span>
                    {on && <Check size={18} aria-hidden />}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="mt-10 grid gap-3" role="radiogroup" aria-labelledby="onb-title">
                {UI_MODES.map((m) => (
                  <label key={m} className={cx("flex cursor-pointer items-center gap-4 rounded-[var(--radius-panel)] border px-5 py-4 has-[:focus-visible]:outline has-[:focus-visible]:outline-2", chosen === m ? "border-ink bg-surface-2" : "border-line hover:border-line-strong")}>
                    <input type="radio" name="mode" className="sr-only" checked={chosen === m} onChange={() => setMode(m)} />
                    <span className="flex-1">
                      <span className="block text-[18px]">
                        {MODE_INFO[m].label}
                        {suggested === m && <span className="ml-2 text-[13px] text-ok">Fits your answers</span>}
                      </span>
                      <span className="block text-[14px] text-ink-2">{MODE_INFO[m].body}</span>
                    </span>
                    {chosen === m && <Check size={18} aria-hidden />}
                  </label>
                ))}
              </div>
              <p className="mt-3 text-[13px] text-ink-2">Change it any time at the top of the window. After a hackathon ends, Nexus opens in Advanced.</p>
            </>
          )}
          {error && (
            <p role="alert" className="mt-4 text-bad">
              {error}
            </p>
          )}
          <div className="mt-8 flex gap-2">
            {step > 0 && (
              <Button size="lg" onClick={() => setStep(step - 1)} disabled={busy}>
                <ArrowLeft size={15} aria-hidden /> Back
              </Button>
            )}
            {!q && (
              <Button size="lg" variant="primary" disabled={busy} onClick={() => finish(chosen, a as Profile)}>
                Open {MODE_INFO[chosen].label}
              </Button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
