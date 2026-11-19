/** Types shared by the Nexus Local Runtime (server) and the UI. Client-safe: no secrets live here. */

export const TASK_TYPES = ["plan", "build", "debug", "refactor", "test", "review", "document", "research"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_LABELS: Record<TaskType, string> = {
  plan: "Plan",
  build: "Build",
  debug: "Debug",
  refactor: "Refactor",
  test: "Test",
  review: "Review",
  document: "Document",
  research: "Research",
};

export const PREFERENCES = ["quality", "speed", "low-resource", "local-only", "minimal-tokens"] as const;
export type Preference = (typeof PREFERENCES)[number];
export const PREFERENCE_LABELS: Record<Preference, string> = {
  quality: "Best quality",
  speed: "Speed",
  "low-resource": "Low resource use",
  "local-only": "Private, local only",
  "minimal-tokens": "Fewest tokens",
};

export const CONCISE_MODES = ["normal", "concise", "aggressive"] as const;
export type ConciseMode = (typeof CONCISE_MODES)[number];
export const CONCISE_LABELS: Record<ConciseMode, string> = {
  normal: "Normal",
  concise: "Concise",
  aggressive: "Aggressive compression",
};

// ---------- Agents ----------

export type AgentKind = "coding-cli" | "harness" | "local-runtime";

/** What Nexus itself has implemented and tested for this agent. */
export type IntegrationLevel = "supported" | "detection-only" | "out-of-scope";

export type InstallState = "installed" | "not-installed" | "error";
export type AuthState = "authenticated" | "needs-sign-in" | "not-required" | "unknown" | "unavailable";

export type Capability =
  | "interactive"
  | "headless"
  | "streaming"
  | "parallel"
  | "edits-project"
  | "skills"
  | "mcp"
  | "resume"
  | "usage"
  | "local-models"
  | "images";

export const CAPABILITY_LABELS: Record<Capability, string> = {
  interactive: "Interactive session",
  headless: "Non-interactive runs",
  streaming: "Streaming events",
  parallel: "Parallel sessions",
  "edits-project": "Edits project files",
  skills: "Agent Skills",
  mcp: "MCP servers",
  resume: "Resume / revise",
  usage: "Usage reporting",
  "local-models": "Local models",
  images: "Generates images",
};

export type AgentStatus = {
  id: string;
  displayName: string;
  vendor: string;
  kind: AgentKind;
  integration: IntegrationLevel;
  integrationNote: string;
  install: InstallState;
  version: string | null;
  binaryPath: string | null;
  auth: AuthState;
  authDetail: string;
  /** Plain, non-secret account facts the CLI reports (method, plan). Never emails or ids. */
  accountFacts: { label: string; value: string }[];
  /** Capabilities of the agent itself, per its docs; Nexus uses only those it implements. */
  capabilities: Capability[];
  /** Capabilities Nexus drives through this adapter today. */
  nexusCapabilities: Capability[];
  models: string[];
  /** Labels for models, when the agent publishes them (Codex's own model catalog). */
  modelInfo?: { id: string; label: string; description: string }[];
  installCommands: { label: string; command: string }[];
  loginCommand: { label: string; command: string; runnable: boolean } | null;
  docsUrl: string;
  license: string;
  eligibility: string;
  checkedAt: string;
};

// ---------- Projects ----------

export type GitState = {
  isRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  changes: { path: string; status: string }[];
  worktrees: { path: string; branch: string | null }[];
  error?: string;
};

export type Project = {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  lastOpenedAt: string;
};

// ---------- Sessions ----------

export const SESSION_STATUSES = ["queued", "starting", "running", "completed", "failed", "cancelled", "applied", "discarded"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type PermissionSet = {
  editFiles: boolean;
  runShell: boolean;
  network: boolean;
  isolate: boolean; // run in a git worktree
};

export const DEFAULT_PERMISSIONS: PermissionSet = { editFiles: true, runShell: false, network: false, isolate: true };

export type UsageMetrics = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  contextWindow?: number;
  model?: string;
  durationMs?: number;
  /** Subscription windows exactly as the agent reported them. */
  quota?: { window: string; utilization: number; resetsAt?: string; status?: string }[];
  source: string;
};

export type SessionRole = "solo" | "plan" | "build" | "review" | "parallel" | "revise" | "copy" | "assets";

export type Session = {
  id: string;
  workflowId: string | null;
  projectId: string;
  agentId: string;
  role: SessionRole;
  title: string;
  brief: string;
  status: SessionStatus;
  cwd: string;
  worktreeBranch: string | null;
  baseRef: string | null;
  nativeSessionId: string | null;
  parentSessionId: string | null;
  dependsOn: string | null;
  /** All steps that must finish first (team builds). dependsOn stays the first of these. */
  after?: string[];
  /** Run in the same worktree as this session (team builds share one worktree). */
  shareWorktreeOf?: string | null;
  /** If this step fails, dependent steps still run. */
  optional?: boolean;
  /** Agents that already tried this step and could not run it (sign-in, limits). */
  triedAgents?: string[];
  /** Shown above the output, e.g. when Nexus handed the step to another agent. */
  notice?: string | null;
  permissions: PermissionSet;
  conciseMode: ConciseMode;
  skills: string[];
  model: string | null;
  command: string[]; // redacted argv preview
  usage: UsageMetrics | null;
  error: string | null;
  summary: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
};

export type AgentEventKind = "status" | "text" | "thinking" | "tool" | "tool-result" | "file" | "usage" | "error" | "stderr" | "system";

export type AgentEvent = {
  id: number;
  sessionId: string;
  at: string;
  kind: AgentEventKind;
  text: string;
  data?: Record<string, unknown>;
};

export type Workflow = {
  id: string;
  projectId: string;
  name: string;
  preset: PresetId;
  goal: string;
  brief: string;
  createdAt: string;
  saved: boolean;
};

export const PRESETS = ["swarm", "solo", "plan-build-review", "parallel", "debug-test", "frontend-polish"] as const;
export type PresetId = (typeof PRESETS)[number];

// ---------- Skills ----------

export type ReviewOutcome = "reviewed" | "review-required" | "blocked" | "not-reviewed";

export type ReviewFinding = { severity: "high" | "medium" | "low" | "info"; file: string; line?: number; rule: string; detail: string };

export type SkillReview = {
  outcome: ReviewOutcome;
  findings: ReviewFinding[];
  checked: string[];
  notChecked: string[];
  reviewedAt: string;
  filesScanned: number;
};

export type CatalogSkill = {
  /** owner/repo@skill */
  id: string;
  owner: string;
  repo: string;
  skill: string;
  installs: number | null;
  url: string;
  source: string;
  retrievedAt: string;
};

export type SkillDetail = {
  id: string;
  owner: string;
  repo: string;
  skill: string;
  name: string;
  description: string;
  repoUrl: string;
  sourcePath: string | null;
  ref: string | null;
  commit: string | null;
  license: string | null;
  stars: number | null;
  pushedAt: string | null;
  lastCommitAt: string | null;
  files: { path: string; size: number; kind: "skill" | "script" | "doc" | "asset" | "config" | "other" }[];
  skillMd: string | null;
  frontmatter: Record<string, unknown>;
  hooks: boolean;
  allowedTools: string[];
  mcpServers: string[];
  dependencies: string[];
  review: SkillReview;
  retrievedAt: string;
  error?: string;
};

export type InstalledSkill = {
  name: string;
  path: string;
  scope: "project" | "global";
  agents: string[];
  source: string | null;
  sourceType: string | null;
  status: string | null;
};

export type StackStage = "plan" | "build" | "test" | "review" | "ship";
export const STACK_STAGES: StackStage[] = ["plan", "build", "test", "review", "ship"];

export type SkillStack = {
  projectId: string;
  instructions: string;
  items: { id: string; stage: StackStage }[];
  updatedAt: string;
};

// ---------- MCP ----------

export type McpServer = {
  name: string;
  target: string;
  transport: string;
  status: "connected" | "needs-auth" | "failed" | "pending-approval" | "unknown";
  statusText: string;
  source: string;
};

// ---------- Brief ----------

export type BriefResult = {
  taskType: TaskType;
  brief: string;
  changes: string[];
  assumptions: string[];
  missing: string[];
  engine: { kind: "template" } | { kind: "local-model"; agentId: string; model: string };
};

export type Recommendation = {
  agents: { agentId: string; score: number; reasons: string[]; blockers: string[] }[];
  skills: { id: string; installed: boolean; why: string }[];
  rationale: string;
};

export type Settings = {
  concurrency: number;
  defaultConcise: ConciseMode;
  defaultPreference: Preference;
  defaultPermissions: PermissionSet;
  ollamaModel: string | null;
  claudeModel: string | null;
  codexModel: string | null;
  /** Write NEXUS_MAP.md into each session's worktree and tell the agent to read it first. */
  projectMap: boolean;
  /** Hold `caffeinate` while steps run, so the Mac doesn't idle-sleep mid-build. */
  keepAwake: boolean;
  /** Wi-Fi network to join when the connection drops during a run (for example an iPhone hotspot). */
  backupNetwork: string | null;
  /** Show the Advanced workspace: every agent's terminal output, exact command and process tree. */
  advancedMode: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  concurrency: 2,
  defaultConcise: "normal",
  defaultPreference: "quality",
  defaultPermissions: DEFAULT_PERMISSIONS,
  ollamaModel: null,
  claudeModel: null,
  codexModel: null,
  projectMap: true,
  keepAwake: true,
  backupNetwork: null,
  advancedMode: false,
};
