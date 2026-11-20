"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cx } from "./ui";

/**
 * Custom select: a button that opens a floating list with names and a second line (a path, a
 * model's size), a search box for long lists, and full keyboard use (arrows, Enter, Escape,
 * typing to filter). Replaces the operating system's plain dropdown.
 */

export type PickerOption = { value: string; label: string; hint?: string; disabled?: boolean };

export function Picker({
  value,
  onChange,
  options,
  label,
  placeholder = "Choose…",
  className,
  size = "md",
  id,
  disabled,
  action,
}: {
  value: string;
  onChange: (v: string) => void;
  options: PickerOption[];
  /** Accessible name; shown to screen readers only. */
  label: string;
  placeholder?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  id?: string;
  disabled?: boolean;
  /** An extra row under the options, e.g. "Add a project". */
  action?: { label: string; icon?: React.ReactNode; onClick: () => void };
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);
  const searchable = options.length > 7;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 280 && r.top > below;
    setPos({ left: r.left, top: up ? r.top - 6 : r.bottom + 6, width: Math.max(r.width, 240), up });
  };

  useLayoutEffect(() => {
    if (!open) return;
    // Measure the button once the list opens, then follow scrolls and resizes.
    place();
    const i = Math.max(0, shown.findIndex((o) => o.value === value));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActive(i);
    const onScroll = () => place();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
    // Only when opening; the active row then follows the keyboard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (searchable ? search.current : list.current)?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !list.current?.parentElement?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, searchable]);

  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (o: PickerOption | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
    setQuery("");
    btn.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      setQuery("");
      if (e.key === "Escape") btn.current?.focus();
    }
  };

  const h = size === "sm" ? "h-8 text-[12.5px]" : size === "lg" ? "h-12 text-[15px]" : "h-10 text-[14px]";

  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${current?.label ?? placeholder}`}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cx(
          "group flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-line bg-[color-mix(in_oklab,var(--ink)_4%,var(--canvas))] px-3 text-left text-ink transition-colors hover:border-line-strong focus-visible:border-ink-3 focus-visible:outline-none disabled:opacity-50",
          open && "border-ink-3",
          h,
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {current ? current.label : <span className="text-ink-3">{placeholder}</span>}
          {current?.hint && size !== "sm" && <span className="ml-2 font-mono text-[0.82em] text-ink-3">{current.hint}</span>}
        </span>
        <ChevronsUpDown size={15} className="shrink-0 text-ink-3 transition-colors group-hover:text-ink" aria-hidden />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            className="picker-pop fixed z-[90] overflow-hidden rounded-xl border border-line-strong bg-[color-mix(in_oklab,var(--surface)_92%,transparent)] shadow-[0_18px_50px_rgb(0_0_0/0.45)] backdrop-blur-xl"
            style={{ left: Math.min(pos.left, window.innerWidth - pos.width - 8), width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
            data-up={pos.up || undefined}
          >
            {searchable && (
              <div className="flex items-center gap-2 border-b border-line px-3">
                <Search size={14} className="text-ink-3" aria-hidden />
                <input
                  ref={search}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onKey}
                  placeholder="Search"
                  aria-label={`Search ${label}`}
                  aria-controls={listId}
                  aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
                  className="h-10 min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-3 focus:outline-none"
                />
              </div>
            )}
            <ul ref={list} id={listId} role="listbox" aria-label={label} tabIndex={-1} onKeyDown={onKey} aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined} className="max-h-72 overflow-y-auto p-1.5 focus:outline-none">
              {shown.map((o, i) => {
                const sel = o.value === value;
                return (
                  <li
                    key={o.value}
                    id={`${listId}-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={sel}
                    aria-disabled={o.disabled}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o)}
                    className={cx(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2",
                      i === active && "bg-[color-mix(in_oklab,var(--ink)_9%,transparent)]",
                      o.disabled && "cursor-not-allowed opacity-45",
                    )}
                  >
                    <span className="grid size-4 shrink-0 place-items-center">{sel && <Check size={15} className="text-ok" aria-hidden />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-ink">{o.label}</span>
                      {o.hint && <span className="block truncate font-mono text-[12px] text-ink-3">{o.hint}</span>}
                    </span>
                  </li>
                );
              })}
              {!shown.length && <li className="px-3 py-3 text-[14px] text-ink-3">Nothing matches.</li>}
            </ul>
            {action && (
              <div className="border-t border-line p-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                    action.onClick();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] text-ink-2 hover:bg-[color-mix(in_oklab,var(--ink)_9%,transparent)] hover:text-ink"
                >
                  <span className="grid size-4 shrink-0 place-items-center">{action.icon}</span>
                  {action.label}
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
