export type TaskStatus = "queued" | "running" | "completed" | "blocked" | "failed";

export type VerificationKind = "command" | "review";

export type VerificationState = "pending" | "passed" | "failed";

export type Provider = "claude-code" | "codex";

export type Gate = "completed" | "verified";

export type Tone = "info" | "success" | "warning" | "failure";

export type ViewId = "canvas" | "agents";

export type PanelTab = "overview" | "proof" | "log" | "edit";

export type Runner = "agent" | "human";

export interface VerificationCheck {
  id: string;
  kind: VerificationKind;
  state: VerificationState;
  timestamp: number | null;
  evidence: string;
  command?: string;
  exitCode?: number | null;
  output?: string;
  durationMs?: number;
  running?: boolean;
  /** What a gate script reported, step by step. */
  steps?: GateStep[];
  /** Files the check left in the task's evidence folder, relative to it. */
  artifacts?: string[];
}

export interface GateStep {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface CheckRun {
  command: string;
  exitCode: number | null;
  output: string;
  durationMs: number;
  timedOut?: boolean;
  steps?: GateStep[];
  artifacts?: string[];
}

export interface FilePreview {
  path: string;
  text: string;
}

/** Where an agent task's work lives. Set by its first run. */
export interface TaskGit {
  branch: string;
  folder: string;
  /** The project folder's branch, which this task merges into. */
  target: string;
  head?: string;
  merged?: { into: string; sha: string; at: number };
}

export interface Task {
  id: string;
  projectId: string;
  name: string;
  objective: string;
  description: string;
  acceptance: string[];
  status: TaskStatus;
  runner: Runner;
  sessionId?: string | null;
  agentId: string | null;
  worktree: string;
  startedAt: number | null;
  elapsedMs: number;
  activity: string;
  blocker: string | null;
  gated?: boolean;
  position: { x: number; y: number };
  verification: VerificationCheck[];
  filesChanged: string[];
  /** For a task with a branch, each file's diff against where the task started. */
  previews: FilePreview[];
  instructions: string[];
  checkCommand?: string;
  git?: TaskGit;
  /** Start the agent as soon as every gate into this task is open. */
  autoRun?: boolean;
  /** Leave the upstream agents' own summaries out of this task's prompt, so it judges their work from the files. */
  independent?: boolean;
  /** Why the task's verification no longer counts: upstream work changed after it ran. */
  outdated?: string;
  /** Automatic retries since its check last passed. */
  retries?: number;
}

export interface Dependency {
  id: string;
  source: string;
  target: string;
  gate: Gate;
}

export interface Agent {
  id: string;
  name: string;
  provider: Provider;
  model: string;
}

export interface ExecutionEvent {
  id: string;
  taskId: string;
  projectId: string;
  at: number;
  message: string;
  tone: Tone;
}

export interface Notification {
  id: string;
  at: number;
  message: string;
  tone: Tone;
  taskId?: string;
  read: boolean;
}

export interface Project {
  id: string;
  name: string;
  summary: string;
  directory?: string;
}

export interface OrchestrationState {
  schema: 2;
  projects: Project[];
  tasks: Task[];
  dependencies: Dependency[];
  events: ExecutionEvent[];
  notifications: Notification[];
  now: number;
  seq: number;
  /** The folder that holds every project. Unset means the server's default. */
  workspace?: string;
}

export interface Filters {
  status: TaskStatus | "all";
  agentId: string | "all";
  verification: "all" | "verified" | "unverified" | "failed";
  savedView: "all" | "needs-me" | "running" | "unverified";
  search: string;
}

export interface UiState {
  view: ViewId;
  projectId: string;
  selectedTaskId: string | null;
  selectedAgentId: string | null;
  selectedEdgeId: string | null;
  inspectorOpen: boolean;
  panelTab: PanelTab;
  filters: Filters;
  paletteOpen: boolean;
  newTaskOpen: boolean;
  newProjectOpen: boolean;
  decomposeOpen: boolean;
  decomposeSeed: string;
  contextMenu: { x: number; y: number; taskId: string } | null;
  fitToken: number;
}

export type Action =
  | { type: "moveTask"; id: string; position: { x: number; y: number } }
  | { type: "connect"; source: string; target: string; gate?: Gate }
  | { type: "disconnect"; id: string }
  | { type: "createProject"; project: Project }
  | { type: "createTask"; task: Task; dependsOn?: { source: string; gate?: Gate }[] }
  | { type: "updateTask"; id: string; patch: Partial<Task> }
  | { type: "setStatus"; id: string; status: TaskStatus }
  | { type: "setCheck"; taskId: string; checkId: string; state: "passed" | "failed" | "pending" }
  | { type: "setCheckCommand"; id: string; command: string }
  | { type: "startCheck"; taskId: string }
  | { type: "recordCheck"; taskId: string; run: CheckRun }
  | { type: "reassign"; id: string; agentId: string | null }
  | { type: "instruct"; id: string; text: string }
  | { type: "merged"; id: string; into: string; sha: string }
  | { type: "setWorkspace"; path: string }
  | { type: "outdate"; id: string; reason: string }
  | {
      type: "refreshed";
      id: string;
      head: string;
      merged: string[];
      filesChanged: string[];
      previews: FilePreview[];
      keepReview: boolean;
    }
  | { type: "approvePlan"; tasks: Task[]; dependencies: Dependency[] }
  | { type: "deleteTask"; id: string }
  | { type: "reset" }
  | { type: "dismissNotification"; id: string }
  | { type: "readNotifications" };

export const STATUSES: TaskStatus[] = ["queued", "running", "completed", "blocked", "failed"];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  blocked: "Blocked",
  failed: "Failed",
};

export const CHECK_LABEL: Record<VerificationKind, string> = {
  command: "Check command",
  review: "Review",
};

export const GATE_LABEL: Record<Gate, string> = {
  completed: "once finished",
  verified: "once verified",
};

export const SAVED_VIEWS: { id: Filters["savedView"]; label: string }[] = [
  { id: "all", label: "All tasks" },
  { id: "needs-me", label: "Needs me" },
  { id: "running", label: "Running" },
  { id: "unverified", label: "Unverified" },
];
