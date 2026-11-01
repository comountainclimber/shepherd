export type TaskStatus = "queued" | "running" | "completed" | "blocked" | "failed";

export type VerificationKind = "command" | "review";

export type VerificationState = "pending" | "passed" | "failed";

export type Provider = "claude-code" | "codex";

export type Gate = "completed" | "verified";

export type Tone = "info" | "success" | "warning" | "failure";

export type ViewId = "canvas" | "agents";

export type PanelTab = "step" | "output" | "checks" | "log";

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
  /** What the agent said when its last run finished. Later steps get it in their prompts. */
  output?: string;
  /** Its inputs were set by hand on the map, so the outline no longer decides what it waits for. */
  wired?: boolean;
  /** Screenshots Shepherd took for its agent, newest last. */
  looks?: Look[];
  /** Problems found in its work and left for later. */
  issues?: Issue[];
  /** Shepherd is writing this step's checklist from the earlier steps' work. Not saved. */
  drafting?: boolean;
  /** A checklist Shepherd suggested for this step, until you use it or discard it. */
  checklist?: string;
  /** The model its agent uses. Unset uses the agent's own default. */
  model?: string;
  /** How hard its agent thinks. Unset uses the default. */
  effort?: Effort;
  /** The saved step it was copied from, and which version. */
  savedFrom?: { id: string; version: number };
}

export const EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type Effort = (typeof EFFORTS)[number];

/** A step, or a few steps that run side by side, kept for adding to any project. */
export interface SavedStep {
  id: string;
  name: string;
  version: number;
  updatedAt: number;
  /** Came with Shepherd. */
  starter?: boolean;
  steps: SavedStepItem[];
}

/** What a saved step keeps of a step: what to do and who does it, but nothing from its runs. */
export interface SavedStepItem {
  name: string;
  runner: Runner;
  agentId: string | null;
  model?: string;
  effort?: Effort;
  objective: string;
  description: string;
  acceptance: string[];
  checkCommand?: string;
  review?: boolean;
  independent?: boolean;
  /** Its indent in the block. Steps at 1 run side by side under the step they are added after. */
  depth: number;
}

/** A screenshot of a page, taken by Shepherd because a browser cannot start in an agent's sandbox. */
export interface Look {
  /** The PNG's name in the step's looks folder. */
  file: string;
  url: string;
  width: number;
  height: number;
  at: number;
  /** What the page logged or threw as errors while Shepherd looked. */
  errors: string[];
}

/** Something wrong with a step's work that someone noted and left for later. */
export interface Issue {
  id: string;
  text: string;
  at: number;
  /** The step made to fix it. */
  stepId?: string;
}

export interface Dependency {
  id: string;
  source: string;
  target: string;
  gate: Gate;
  /** Made from the outline's order. Shepherd redraws these whenever the outline changes. */
  outline?: boolean;
}

/** A step's place in a project's outline. Indented steps run side by side after the step above them. */
export interface OutlineItem {
  id: string;
  depth: number;
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
  /** The steps in order. Unset for older projects, whose arrows were all drawn by hand. */
  outline?: OutlineItem[];
  /** Shepherd starts each step as soon as the steps before it are done. */
  running?: boolean;
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
  newProjectOpen: boolean;
  contextMenu: { x: number; y: number; taskId: string } | null;
  fitToken: number;
  /** Bumped to put the cursor in the outline's goal box. */
  draftToken: number;
  /** A goal to start that box with. */
  draftSeed: string;
  /** The step whose Save for reuse dialog is open. */
  saveFor: string | null;
  /** Where the saved step you pick from the outline's list goes. */
  addSaved: SavedPlace | null;
  manageSaved: boolean;
}

/** Where a saved step is added: after a row, at that row's indent, or in place of an empty row. */
export interface SavedPlace {
  after: string | null;
  depth: number;
  /** An empty step the saved step takes the place of. */
  replace?: string;
  /** "Adds after “Build it”", or "Adds at the end". */
  label: string;
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
  | { type: "reassign"; id: string; agentId: string | null; runner?: Runner }
  /** Inserts steps into the outline after the step `after`, or at the top when it is null. */
  | { type: "addSteps"; projectId: string; after: string | null; steps: { task: Task; depth: number }[] }
  | { type: "setOutline"; projectId: string; items: OutlineItem[] }
  | { type: "followOutline"; id: string }
  | { type: "setReview"; id: string; on: boolean }
  | { type: "setPlanRunning"; projectId: string; running: boolean }
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
  | { type: "looked"; id: string; look: Look }
  | { type: "noteIssue"; id: string; text: string }
  | { type: "dropIssue"; id: string; issueId: string }
  /** Adds `task` at the end of the outline to fix the issue, and links the two. */
  | { type: "fixIssue"; id: string; issueId: string; task: Task }
  /** Makes the suggested checklist the step's prompt, or discards it. */
  | { type: "settleChecklist"; id: string; use: boolean }
  /** null goes back to the agent's default. */
  | { type: "setModel"; id: string; model: string | null; effort: Effort | null }
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
  completed: "when it finishes",
  verified: "when its checks pass",
};

export const SAVED_VIEWS: { id: Filters["savedView"]; label: string }[] = [
  { id: "all", label: "All tasks" },
  { id: "needs-me", label: "Needs me" },
  { id: "running", label: "Running" },
  { id: "unverified", label: "Unverified" },
];
