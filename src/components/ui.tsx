"use client";

import { forwardRef, useEffect, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { PixelText } from "./mosaic";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink border border-accent hover:bg-accent-hover disabled:bg-line-strong disabled:border-line-strong disabled:text-ink-3",
  secondary: "bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] text-ink border border-[color-mix(in_oklab,var(--ink)_16%,transparent)] hover:bg-[color-mix(in_oklab,var(--ink)_12%,transparent)] hover:border-[color-mix(in_oklab,var(--ink)_30%,transparent)] disabled:text-ink-3",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-2 disabled:text-ink-3",
  danger: "bg-surface text-bad border border-line hover:border-bad hover:bg-bad-soft",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 px-2.5 text-[11.5px] gap-1.5",
  md: "h-[34px] px-3.5 text-[12px] gap-2",
  lg: "h-10 px-4 text-[12.5px] gap-2",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }
>(function Button({ variant = "secondary", size = "md", className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "btn-step inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] font-mono font-medium tracking-[0.04em] whitespace-nowrap max-sm:min-h-11 disabled:cursor-not-allowed",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...props}
    />
  );
});

type Tone = "neutral" | "accent" | "ok" | "warn" | "bad";
const TONE: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  accent: "bg-accent-soft text-accent border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  bad: "bg-bad-soft text-bad border-transparent",
};

export function Badge({ tone = "neutral", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-[var(--radius-chip)] border px-1.5 py-px text-[12px] leading-5 font-medium whitespace-nowrap", TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={cx("animate-spin", className)} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** A command the user can copy and run themselves. Nexus never runs these for the user. */
export function CommandLine({ command, label }: { command: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch overflow-hidden rounded-[var(--radius-control)] border border-line bg-term">
      <code className="min-w-0 flex-1 overflow-x-auto px-3 py-2 font-mono text-[12px] whitespace-pre text-ink" aria-label={label}>
        {command}
      </code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {}
        }}
        className="shrink-0 border-l border-line px-2.5 text-[12px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Right-hand sheet for details. */
export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button aria-label="Close" className="absolute inset-0 bg-[rgb(5_7_10/0.55)]" onClick={onClose} />
      <aside role="dialog" aria-modal="true" className="rise-in absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-line bg-surface shadow-2xl">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">{title}</div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel">
            Close
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
      </aside>
    </div>
  );
}

/**
 * Page band in the Home hero's look: still mosaic, a short pixel word, a plain heading that names
 * the page's subject, one or two sentences under it and at most two actions.
 */
export function PageHeader({ title, pixel, heading, sub, actions }: { title: string; pixel?: string; heading?: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-sky mb-7 overflow-hidden rounded-[var(--radius-panel)] border border-white/15 px-4 pt-6 pb-5 text-white sm:px-6 sm:pt-8 sm:pb-6">
      <span className="eyebrow text-white/70">{title}</span>
      {pixel && (
        <div className="mt-4 w-full max-w-[min(100%,calc(var(--px-w,8)*2.6rem))]" style={{ ["--px-w" as string]: pixel.length }}>
          <PixelText text={pixel} />
        </div>
      )}
      {heading && (
        <h2 className="font-display mt-4 max-w-3xl text-[24px] leading-[1.15] sm:text-[32px]">
          {heading}
        </h2>
      )}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        {sub && <p className="max-w-2xl text-[13.5px] leading-relaxed font-light text-white/65">{sub}</p>}
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
  size?: "sm" | "md";
}) {
  const name = useId();
  return (
    <fieldset className="min-w-0 max-w-full">
      <legend className="sr-only">{label}</legend>
      <div className="flex max-w-full gap-0.5 overflow-x-auto rounded-[var(--radius-control)] border border-line bg-canvas p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              "relative flex-1 cursor-pointer rounded-[var(--radius-chip)] text-center font-mono whitespace-nowrap transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
              size === "sm" ? "px-2 py-1 text-[11.5px]" : "px-3 py-1.5 text-[12px]",
              value === o.value ? "bg-accent text-accent-ink" : "text-ink-3 hover:text-ink",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="font-mono text-[12px] text-ink-2">
        {label}
      </label>
      {children}
      {hint && <p className="text-[12px] text-ink-3">{hint}</p>}
    </div>
  );
}

export const selectClass =
  "rounded-[var(--radius-control)] border border-line bg-canvas px-2 text-sm text-ink transition-colors hover:border-line-strong focus:border-ink-3 focus:outline-none";

export const inputClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-3 transition-colors hover:border-line-strong focus:border-ink-3 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent";

/** Accessible modal built on <dialog>. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-[var(--radius-panel)] border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-[rgb(10_14_24/0.45)] backdrop:backdrop-blur-[2px]",
        wide ? "max-w-2xl" : "max-w-md",
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="border-b border-line px-5 py-4">
            <h2 id={titleId} className="font-display text-lg font-semibold">
              {title}
            </h2>
          </div>
          <div className="overflow-y-auto px-5 py-4 text-sm text-ink-2">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  body,
  confirmLabel,
  danger,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-panel)] border border-dashed border-line-strong px-6 py-14 text-center">
      <div className="text-ink-3">{icon}</div>
      <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
      <p className="max-w-sm text-sm text-ink-2">{body}</p>
      {action}
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex justify-center px-4">
      {message && (
        <div className="glass dock-in rounded-full px-4 py-2 text-sm font-medium text-ink">{message}</div>
      )}
    </div>
  );
}

/** Renders `code` spans in plain status text. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="rounded bg-surface-2 px-1 font-mono text-[0.9em] text-ink">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
