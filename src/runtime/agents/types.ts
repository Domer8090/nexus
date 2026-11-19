import type { AgentEventKind, AgentStatus, ConciseMode, PermissionSet, UsageMetrics } from "@/lib/types";

/** Provider-neutral adapter contract. The UI never sees vendor-specific commands. */

export type LaunchInput = {
  sessionId: string;
  brief: string;
  cwd: string;
  permissions: PermissionSet;
  concise: ConciseMode;
  model: string | null;
  skills: string[];
  /** Native session id to continue (revise). */
  resumeNativeId?: string | null;
  /** Extra read-only context, e.g. a diff for a review role. */
  context?: string;
  /** Image files attached to the request. */
  attachments?: string[];
};

export type EventSink = {
  emit(kind: AgentEventKind, text: string, data?: Record<string, unknown>): void;
  setNativeId(id: string): void;
  setModel(model: string): void;
  setUsage(u: UsageMetrics): void;
  setSummary(text: string): void;
  setCommand(argvPreview: string[]): void;
  /** Raw output line from the agent process, for the Advanced terminal view. Redacted by the store. */
  raw?(stream: "out" | "err", line: string): void;
};

export type RunningHandle = {
  /** Resolves when the process ends. */
  done: Promise<{ ok: boolean; error?: string }>;
  cancel(): void;
  /** OS process id of the agent, when it runs as a child process. */
  pid?: number;
};

export interface AgentAdapter {
  id: string;
  /** Static facts, verified from official docs (see README for sources). */
  meta: Omit<AgentStatus, "install" | "version" | "binaryPath" | "auth" | "authDetail" | "accountFacts" | "models" | "checkedAt">;
  detect(): Promise<Pick<AgentStatus, "install" | "version" | "binaryPath" | "auth" | "authDetail" | "accountFacts" | "models">>;
  /** Present only when Nexus has implemented and tested sessions for this agent. */
  launch?(input: LaunchInput, sink: EventSink): RunningHandle;
  /** Argument preview shown before approval. */
  previewCommand?(input: LaunchInput): string[];
}

export const CONCISE_INSTRUCTIONS: Record<ConciseMode, string | null> = {
  normal: null,
  concise:
    "Output style: concise. No filler, pleasantries or repeated recaps. Short sentences. Keep code, commands, file paths, error messages, warnings and security notes exact and complete.",
  aggressive:
    "Output style: maximum compression. Fragments are fine. Drop articles and filler. State each fact once. Never shorten or paraphrase code, commands, file paths, error messages, warnings or security notes.",
};
