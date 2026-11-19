"use client";

import { CircleCheck, CircleDashed, CircleAlert, CircleX, KeyRound, Lock, Loader } from "lucide-react";
import { Badge, cx } from "./ui";
import type { AgentStatus, ReviewOutcome, SessionStatus } from "@/lib/types";

/** Text monogram instead of vendor logos: Nexus doesn't reproduce other products' branding. */
export function AgentMark({ agent, size = "md" }: { agent: Pick<AgentStatus, "displayName" | "kind">; size?: "sm" | "md" | "lg" }) {
  const words = agent.displayName.split(/\s+/).filter((w) => w !== "CLI");
  const letters = words.length > 1 ? words.map((w) => w[0]).join("").slice(0, 2) : words[0].slice(0, 2);
  const tone = agent.kind === "local-runtime" ? "text-ok border-ok/30 bg-ok-soft" : agent.kind === "harness" ? "text-warn border-warn/30 bg-warn-soft" : "text-accent border-accent/30 bg-accent-soft";
  const sz = { sm: "size-6 text-[10px]", md: "size-8 text-[12px]", lg: "size-10 text-[14px]" }[size];
  return (
    <span aria-hidden className={cx("grid shrink-0 place-items-center rounded-[6px] border font-mono font-semibold", tone, sz)}>
      {letters}
    </span>
  );
}

export function InstallBadge({ a }: { a: AgentStatus }) {
  if (a.install === "installed") return <Badge tone="ok" icon={<CircleCheck size={12} aria-hidden />}>Installed{a.version ? ` ${a.version}` : ""}</Badge>;
  if (a.install === "error") return <Badge tone="bad" icon={<CircleX size={12} aria-hidden />}>Detection error</Badge>;
  return <Badge icon={<CircleDashed size={12} aria-hidden />}>Not installed</Badge>;
}

export function AuthBadge({ a }: { a: AgentStatus }) {
  if (a.install !== "installed") return null;
  switch (a.auth) {
    case "authenticated":
      return <Badge tone="ok" icon={<KeyRound size={12} aria-hidden />}>Signed in</Badge>;
    case "needs-sign-in":
      return <Badge tone="warn" icon={<Lock size={12} aria-hidden />}>Needs sign-in</Badge>;
    case "not-required":
      return <Badge icon={<CircleCheck size={12} aria-hidden />}>No sign-in needed</Badge>;
    default:
      return <Badge icon={<CircleDashed size={12} aria-hidden />}>Sign-in unknown</Badge>;
  }
}

export function IntegrationBadge({ a }: { a: AgentStatus }) {
  if (a.integration === "supported") return <Badge tone="accent">Supported in Nexus</Badge>;
  if (a.integration === "detection-only") return <Badge>Detection only</Badge>;
  return <Badge tone="warn">Out of scope</Badge>;
}

const SESSION: Record<SessionStatus, { label: string; tone: "neutral" | "accent" | "ok" | "warn" | "bad"; icon: React.ReactNode }> = {
  queued: { label: "Queued", tone: "neutral", icon: <CircleDashed size={12} aria-hidden /> },
  starting: { label: "Starting", tone: "accent", icon: <Loader size={12} className="animate-spin" aria-hidden /> },
  running: { label: "Running", tone: "accent", icon: <span className="live-dot inline-block size-1.5 rounded-full bg-current" aria-hidden /> },
  completed: { label: "Ready for review", tone: "ok", icon: <CircleCheck size={12} aria-hidden /> },
  failed: { label: "Failed", tone: "bad", icon: <CircleAlert size={12} aria-hidden /> },
  cancelled: { label: "Stopped", tone: "warn", icon: <CircleX size={12} aria-hidden /> },
  applied: { label: "Applied", tone: "ok", icon: <CircleCheck size={12} aria-hidden /> },
  discarded: { label: "Discarded", tone: "neutral", icon: <CircleX size={12} aria-hidden /> },
};

export function SessionBadge({ status, readOnly }: { status: SessionStatus; readOnly?: boolean }) {
  const s = readOnly && status === "completed" ? { ...SESSION.completed, label: "Done" } : SESSION[status];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}

export function sessionLabel(status: SessionStatus) {
  return SESSION[status].label;
}

export function ReviewBadge({ outcome }: { outcome: ReviewOutcome }) {
  if (outcome === "reviewed") return <Badge tone="ok" icon={<CircleCheck size={12} aria-hidden />}>Reviewed</Badge>;
  if (outcome === "review-required") return <Badge tone="warn" icon={<CircleAlert size={12} aria-hidden />}>Review required</Badge>;
  if (outcome === "blocked") return <Badge tone="bad" icon={<CircleX size={12} aria-hidden />}>Blocked</Badge>;
  return <Badge icon={<CircleDashed size={12} aria-hidden />}>Not reviewed</Badge>;
}
