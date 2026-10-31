import { isDemoState, projectDirectory } from "./workspace";
import type {
  Dependency,
  ExecutionEvent,
  FilePreview,
  Notification,
  OrchestrationState,
  Project,
  Task,
  TaskGit,
  TaskStatus,
  VerificationCheck,
} from "./types";

type Raw = Record<string, unknown>;

const STATUSES = new Set<TaskStatus>(["queued", "running", "completed", "blocked", "failed"]);

function record(value: unknown): Raw | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function project(raw: Raw): Project {
  const directory = text(raw.directory);
  return { id: text(raw.id), name: text(raw.name), summary: text(raw.summary), ...(directory ? { directory } : {}) };
}

function check(raw: Raw): VerificationCheck | null {
  if (raw.kind !== "command" && raw.kind !== "review") return null;
  if (raw.state !== "pending" && raw.state !== "passed" && raw.state !== "failed") return null;
  const out: VerificationCheck = {
    id: text(raw.id),
    kind: raw.kind,
    state: raw.state,
    timestamp: typeof raw.timestamp === "number" ? raw.timestamp : null,
    evidence: text(raw.evidence),
  };
  if (typeof raw.command === "string") out.command = raw.command;
  if (typeof raw.exitCode === "number" || raw.exitCode === null) out.exitCode = raw.exitCode;
  if (typeof raw.output === "string") out.output = raw.output;
  if (typeof raw.durationMs === "number") out.durationMs = raw.durationMs;
  if (raw.running === true) out.running = true;
  return out;
}

/** After a page load no request is left to record a running check, so it would stay "running" forever. */
export function interruptChecks(state: OrchestrationState): OrchestrationState {
  if (!state.tasks.some((task) => task.verification.some((check) => check.running))) return state;
  return {
    ...state,
    tasks: state.tasks.map((task) => ({
      ...task,
      verification: task.verification.map((check) =>
        check.running ? { ...check, running: false, evidence: "Interrupted by a reload. Run it again." } : check,
      ),
    })),
  };
}

function taskGit(value: unknown): TaskGit | null {
  const raw = record(value);
  if (!raw || typeof raw.branch !== "string" || typeof raw.folder !== "string") return null;
  const merged = record(raw.merged);
  return {
    branch: raw.branch,
    folder: raw.folder,
    target: text(raw.target, "main"),
    ...(typeof raw.head === "string" ? { head: raw.head } : {}),
    ...(merged && typeof merged.sha === "string"
      ? { merged: { into: text(merged.into), sha: merged.sha, at: Number(merged.at) || 0 } }
      : {}),
  };
}

function previews(raw: Raw): FilePreview[] {
  if (Array.isArray(raw.previews)) {
    return raw.previews.flatMap((item) => {
      const preview = record(item);
      return preview ? [{ path: text(preview.path), text: text(preview.text) }] : [];
    });
  }
  return list(raw.artifacts).flatMap((item) => {
    const artifact = record(item);
    return artifact ? [{ path: text(artifact.title), text: text(artifact.summary) }] : [];
  });
}

function task(raw: Raw): Task {
  const id = text(raw.id);
  const position = record(raw.position);
  const status = STATUSES.has(raw.status as TaskStatus) ? (raw.status as TaskStatus) : "queued";
  const checkCommand = text(raw.checkCommand);
  const git = taskGit(raw.git);
  return {
    id,
    projectId: text(raw.projectId),
    name: text(raw.name),
    objective: text(raw.objective),
    description: text(raw.description),
    acceptance: list(raw.acceptance)
      .map((item) => (typeof item === "string" ? item : text(record(item)?.text)))
      .filter((item) => item && item !== "The objective is met"),
    status,
    runner: raw.runner === "human" ? "human" : "agent",
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : null,
    agentId: typeof raw.agentId === "string" ? raw.agentId : null,
    worktree: text(raw.worktree, id),
    startedAt: typeof raw.startedAt === "number" ? raw.startedAt : null,
    elapsedMs: typeof raw.elapsedMs === "number" ? raw.elapsedMs : 0,
    activity: text(raw.activity),
    blocker: typeof raw.blocker === "string" ? raw.blocker : null,
    ...(raw.gated === true ? { gated: true } : {}),
    position: { x: Number(position?.x) || 0, y: Number(position?.y) || 0 },
    verification: list(raw.verification).flatMap((item) => {
      const parsed = record(item) && check(item as Raw);
      return parsed ? [parsed] : [];
    }),
    filesChanged: list(raw.filesChanged)
      .map((item) => (typeof item === "string" ? item : text(record(item)?.path)))
      .filter(Boolean),
    previews: previews(raw),
    instructions: list(raw.instructions).filter((item): item is string => typeof item === "string"),
    ...(checkCommand ? { checkCommand } : {}),
    ...(git ? { git } : {}),
    ...(raw.autoRun === true ? { autoRun: true } : {}),
    ...(raw.independent === true ? { independent: true } : {}),
  };
}

/** Reads a saved board from any earlier schema. Returns null when there is nothing worth keeping. */
export function loadState(saved: unknown): OrchestrationState | null {
  const raw = record(saved);
  if (!raw || (raw.schema !== 1 && raw.schema !== 2) || isDemoState(raw)) return null;
  const projects = list(raw.projects).flatMap((item) => (record(item) ? [project(item as Raw)] : []));
  if (!projects.length) return null;
  // The workspace folder holds every project, so it cannot be one project's repository.
  for (const item of projects) item.directory ||= projectDirectory(item.name, projects);
  return {
    schema: 2,
    projects,
    tasks: list(raw.tasks).flatMap((item) => (record(item) ? [task(item as Raw)] : [])),
    dependencies: list(raw.dependencies) as Dependency[],
    events: list(raw.events) as ExecutionEvent[],
    notifications: list(raw.notifications) as Notification[],
    now: typeof raw.now === "number" ? raw.now : Date.now(),
    seq: typeof raw.seq === "number" ? raw.seq : 1,
  };
}
