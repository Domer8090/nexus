/** Nexus mark: one node routing to parallel lanes. */
export function NexusMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <rect width="28" height="28" rx="6" fill="var(--surface-2)" stroke="var(--line-strong)" />
      <path d="M8 14 C 13 14, 13 8, 20 8 M8 14 H20 M8 14 C 13 14, 13 20, 20 20" stroke="var(--accent)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <circle cx="8" cy="14" r="2.4" fill="var(--ink)" />
      <circle cx="20.5" cy="8" r="1.7" fill="var(--accent)" />
      <circle cx="20.5" cy="14" r="1.7" fill="var(--accent)" />
      <circle cx="20.5" cy="20" r="1.7" fill="var(--accent)" />
    </svg>
  );
}
