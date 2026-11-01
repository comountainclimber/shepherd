import { blankGoal } from "./factory";
import { isEffort, isModelId } from "./models";
import { isDemoState, projectDirectory } from "./workspace";
import type {
  Dependency,
  Goal,
  ExecutionEvent,
  FilePreview,
  Issue,
  Look,
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
  return {
    id: text(raw.id),
    name: text(raw.name),
    summary: text(raw.summary),
    ...(directory ? { directory } : {}),
    ...(text(raw.repo) ? { repo: text(raw.repo) } : {}),
  };
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
  const steps = list(raw.steps).flatMap((item) => {
    const step = record(item);
    return step && typeof step.name === "string" && typeof step.ok === "boolean"
      ? [{ name: step.name, ok: step.ok, ...(typeof step.detail === "string" && step.detail ? { detail: step.detail } : {}) }]
      : [];
  });
  if (steps.length) out.steps = steps;
  const artifacts = list(raw.artifacts).filter((item): item is string => typeof item === "string");
  if (artifacts.length) out.artifacts = artifacts;
  return out;
}

/**
 * When the server starts, no process is left from before: runs and checks that were going are over.
 * Their worktrees keep whatever the agent had written, and the next run commits it.
 */
export function interruptWork(state: OrchestrationState): OrchestrationState {
  const busy = (task: Task) => task.status === "running" || task.verification.some((check) => check.running);
  if (!state.tasks.some(busy)) return state;
  return {
    ...state,
    tasks: state.tasks.map((task) => {
      if (!busy(task)) return task;
      const verification = task.verification.map((check) =>
        check.running ? { ...check, running: false, evidence: "Interrupted when Shepherd restarted. Run it again." } : check,
      );
      if (task.status !== "running") return { ...task, verification };
      const blocker = "Shepherd restarted while this was running. Retry it.";
      return { ...task, verification, status: "failed" as const, blocker, activity: blocker };
    }),
  };
}

function taskGit(value: unknown): TaskGit | null {
  const raw = record(value);
  if (!raw || typeof raw.branch !== "string" || typeof raw.folder !== "string") return null;
  const merged = record(raw.merged);
  return {
    branch: raw.branch,
    folder: raw.folder,
    ...(typeof raw.diffBase === "string" ? { diffBase: raw.diffBase } : {}),
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
    goalId: text(raw.goalId),
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
    ...(typeof raw.outdated === "string" && raw.outdated ? { outdated: raw.outdated } : {}),
    ...(typeof raw.retries === "number" && raw.retries > 0 ? { retries: raw.retries } : {}),
    ...(typeof raw.output === "string" && raw.output ? { output: raw.output } : {}),
    ...(raw.wired === true ? { wired: true } : {}),
    ...listed("looks", list(raw.looks).flatMap(look)),
    ...listed("issues", list(raw.issues).flatMap(issue)),
    ...(typeof raw.checklist === "string" && raw.checklist.trim() ? { checklist: raw.checklist } : {}),
    ...(isModelId(raw.model) ? { model: raw.model } : {}),
    ...(isEffort(raw.effort) ? { effort: raw.effort } : {}),
    ...savedFrom(raw.savedFrom),
  };
}

function savedFrom(raw: unknown): Pick<Task, "savedFrom"> {
  const from = record(raw);
  return from && typeof from.id === "string" && from.id && Number.isInteger(from.version) ? { savedFrom: { id: from.id, version: from.version as number } } : {};
}

function listed<K extends string, T>(key: K, items: T[]): Partial<Record<K, T[]>> {
  return items.length ? ({ [key]: items } as Record<K, T[]>) : {};
}

function look(value: unknown): Look[] {
  const raw = record(value);
  if (!raw || typeof raw.file !== "string" || !/^\w[\w.-]*\.png$/.test(raw.file) || typeof raw.url !== "string") return [];
  return [
    {
      file: raw.file,
      url: raw.url,
      width: Number(raw.width) || 0,
      height: Number(raw.height) || 0,
      at: Number(raw.at) || 0,
      errors: list(raw.errors).filter((item): item is string => typeof item === "string"),
    },
  ];
}

function issue(value: unknown): Issue[] {
  const raw = record(value);
  if (!raw || typeof raw.id !== "string" || typeof raw.text !== "string" || !raw.text.trim()) return [];
  return [{ id: raw.id, text: raw.text, at: Number(raw.at) || 0, ...(typeof raw.stepId === "string" ? { stepId: raw.stepId } : {}) }];
}

/** Reads a saved board from any earlier schema. Returns null when there is nothing worth keeping. */
export function loadState(saved: unknown): OrchestrationState | null {
  const raw = record(saved);
  if (!raw || (raw.schema !== 1 && raw.schema !== 2 && raw.schema !== 3) || isDemoState(raw)) return null;
  const projects = list(raw.projects).flatMap((item) => (record(item) ? [project(item as Raw)] : []));
  if (!projects.length) return null;
  // The workspace folder holds every project, so it cannot be one project's repository.
  for (const item of projects) if (!item.repo) item.directory ||= projectDirectory(item.name, projects);
  const goals: Goal[] = raw.schema === 3
    ? list(raw.goals).flatMap((item) => {
        const value = record(item);
        if (!value || !projects.some((project) => project.id === value.projectId)) return [];
        const merged = record(value.merged);
        const { outline: _empty, ...goal } = blankGoal(text(value.projectId), text(value.name), text(value.id), text(value.goal));
        return [{
          ...goal,
          ...parseOutline(value),
          running: value.running === true,
          status: value.status === "done" || value.status === "archived" ? value.status : "open",
          ...(typeof value.branch === "string" ? { branch: value.branch } : {}),
          ...(typeof value.folder === "string" ? { folder: value.folder } : {}),
          ...(typeof value.base === "string" ? { base: value.base } : {}),
          ...(typeof value.blocker === "string" ? { blocker: value.blocker } : {}),
          ...(merged && typeof merged.into === "string" && typeof merged.sha === "string" && typeof merged.at === "number" ? { merged: { into: merged.into, sha: merged.sha, at: merged.at } } : {}),
        } as Goal];
      })
    : projects.map((project) => {
        const value = list(raw.projects).map(record).find((item) => item?.id === project.id)!;
        const { outline: _empty, ...goal } = blankGoal(project.id, project.name);
        return { ...goal, ...parseOutline(value), running: value.running === true };
      });
  const tasks = list(raw.tasks).flatMap((item) => (record(item) ? [task(item as Raw)] : []));
  if (raw.schema !== 3) for (const task of tasks) task.goalId = goals.find((goal) => goal.projectId === task.projectId)?.id ?? "";
  return {
    schema: 3,
    goals,
    projects,
    tasks,
    dependencies: list(raw.dependencies) as Dependency[],
    events: list(raw.events) as ExecutionEvent[],
    notifications: list(raw.notifications) as Notification[],
    now: typeof raw.now === "number" ? raw.now : Date.now(),
    seq: typeof raw.seq === "number" ? raw.seq : 1,
    ...(typeof raw.workspace === "string" && raw.workspace.trim() ? { workspace: raw.workspace.trim() } : {}),
  };
}

function parseOutline(raw: Raw): Pick<Goal, "outline"> {
  return Array.isArray(raw.outline) ? { outline: raw.outline.flatMap((item) => {
    const step = record(item);
    return step && typeof step.id === "string" ? [{ id: step.id, depth: Number.isInteger(step.depth) ? step.depth as number : 0 }] : [];
  }) } : {};
}
