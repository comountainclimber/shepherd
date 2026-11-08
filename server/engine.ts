import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { interruptWork, loadState } from "../src/model/migrate";
import { isGraphColor } from "../src/model/graphs";
import { isEffort, isModelId } from "../src/model/models";
import { reducer } from "../src/model/reducer";
import type { Action, OrchestrationState } from "../src/model/types";
import { workspace } from "../src/model/workspace";
import { formatDuration } from "../src/model/format";
import { commandLine } from "../src/runner/timeline";
import { workCheckPassed } from "../src/model/workCheck";
import { acceptanceItems } from "../src/model/acceptance";
import { createTimelines, type Timelines } from "./timelines";

/** Edits a tab may send. Run lifecycle actions (running, checks, merges) only come from the server. */
export const TAB_ACTIONS = new Set<Action["type"]>([
  "moveTask",
  "connect",
  "disconnect",
  "createProject",
  "createObjective",
  "updateObjective",
  "archiveObjective",
  "restoreObjective",
  "createGoal",
  "updateGoal",
  "moveGoal",
  "finishGoal",
  "archiveGoal",
  "reopenGoal",
  "deleteGoal",
  "createTask",
  "updateTask",
  "setCheck",
  "setCheckCommand",
  "reassign",
  "deleteTask",
  "approvePlan",
  "reset",
  "dismissNotification",
  "readNotifications",
  "setWorkspace",
  "instruct",
  "addSteps",
  "setOutline",
  "followOutline",
  "setReview",
  "setWorkCheck",
  "noteIssue",
  "dropIssue",
  "fixIssue",
  "settleChecklist",
  "setModel",
]);

/** Fields of a task a tab may edit directly. The rest change only through runs, checks and merges. */
const EDITABLE = new Set(["name", "objective", "description", "acceptance", "autoRun", "independent", "pushBeforeRun"]);

export interface Engine {
  timelines: Timelines;
  get(): OrchestrationState;
  version(): number;
  dispatch(action: Action): OrchestrationState;
  subscribe(listener: () => void): () => void;
  /** Writes pending changes now. */
  flush(): void;
  /** Writes pending changes, then ignores every later action, so a replaced server cannot overwrite the board. */
  close(): void;
}

const WRITE_DELAY_MS = 150;
const BACKUP_EVERY_MS = 60_000;
const BACKUP_LIMIT = 30;

export function createEngine(file: string, clock: () => number = () => Date.now(), initial = workspace()): Engine {
  let state = interruptWork(load(file, initial));
  const timelines = createTimelines(path.join(path.dirname(file), "timelines"), clock);
  const checkRuns = new Map<string, number>();
  for (const task of state.tasks) {
    const entries = timelines.read(task.id).entries;
    const lastRun = [...entries].reverse().find((entry) => entry.kind === "run_started");
    if (lastRun && !entries.some((entry) => entry.run === lastRun.run && entry.kind === "run_ended")) {
      timelines.append(task.id, { kind: "run_ended", outcome: "stopped", text: "Stopped: Shepherd restarted" });
    }
  }
  let version = 1;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastBackupAt = 0;
  let closed = false;
  const listeners = new Set<() => void>();

  const write = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    mkdirSync(path.dirname(file), { recursive: true });
    lastBackupAt = backup(file, state, lastBackupAt, clock());
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(envelope(state)));
    renameSync(temp, file);
  };
  write();

  return {
    timelines,
    get: () => state,
    version: () => version,
    dispatch(action) {
      if (closed) return state;
      const input = { ...state, now: clock() };
      const next = reducer(input, action);
      if (next === input) return state;
      for (const task of state.tasks) if (!next.tasks.some((item) => item.id === task.id)) timelines.delete(task.id);
      if (action.type === "markAcceptance") {
        const task = next.tasks.find((item) => item.id === action.id)!;
        const item = acceptanceItems(task.acceptance).find((item) => item.key === action.key)!;
        timelines.append(task.id, { kind: "acceptance", item: item.number, text: item.text, met: action.note !== null, note: task.acceptanceMarks?.[action.key]?.note });
      }
      if (action.type === "startWorkCheck") {
        checkRuns.set(action.taskId, timelines.append(action.taskId, { kind: "check_started", text: "Work against this step · Codex" }).run);
      }
      if (action.type === "recordWorkCheck") {
        const ok = !!action.result && workCheckPassed(action.result) && !action.failure;
        const run = checkRuns.get(action.taskId);
        timelines.append(action.taskId, { kind: "check_ended", ok, text: `Work against this step: ${ok ? "Passed" : "Failed"}`, detail: action.failure }, run);
        for (const item of action.result?.items ?? []) timelines.append(action.taskId, { kind: "check_ended", ok: item.verdict !== "not met", text: `Done when ${item.item}: ${item.verdict}`, detail: [next.tasks.find((task) => task.id === action.taskId)?.acceptance[item.item - 1], item.reason].filter(Boolean).join("\n") }, run);
        for (const text of action.result?.violations ?? []) timelines.append(action.taskId, { kind: "check_ended", ok: false, text: "Against the step's instructions", detail: text }, run);
        for (const text of action.result?.unrequested ?? []) timelines.append(action.taskId, { kind: "check_ended", ok: true, text: "Not asked for (does not fail the check)", detail: text }, run);
        checkRuns.delete(action.taskId);
      }
      if (action.type === "startCheck") {
        const task = next.tasks.find((item) => item.id === action.taskId);
        if (task) checkRuns.set(task.id, timelines.append(task.id, { kind: "check_started", text: commandLine(task.checkCommand ?? "Check") }).run);
      }
      if (action.type === "recordCheck") {
        const run = action.run;
        const ok = run.exitCode === 0 && !run.timedOut;
        const timelineRun = checkRuns.get(action.taskId);
        timelines.append(action.taskId, { kind: "check_ended", ok, text: `${commandLine(run.command)}: ${run.timedOut ? "Timed out" : run.exitCode === null ? "Failed" : `Exited ${run.exitCode}`} in ${formatDuration(run.durationMs)}`, detail: run.output }, timelineRun);
        for (const step of run.steps ?? []) timelines.append(action.taskId, { kind: "check_ended", ok: step.ok, text: `${step.name}: ${step.ok ? "Passed" : "Failed"}${step.detail ? ` — ${step.detail}` : ""}` }, timelineRun);
        checkRuns.delete(action.taskId);
      }
      if (action.type === "setCheck" && action.state !== "pending") {
        const check = next.tasks.find((task) => task.id === action.taskId)?.verification.find((item) => item.id === action.checkId);
        if (check) timelines.append(action.taskId, { kind: "check_ended", ok: check.state === "passed", text: `${check.kind === "review" ? "Your review" : "Check"}: ${check.state === "passed" ? "Passed" : "Failed"}`, detail: check.evidence });
      }
      state = next;
      version += 1;
      timer ??= setTimeout(write, WRITE_DELAY_MS);
      for (const listener of listeners) listener();
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush() {
      if (timer) write();
    },
    close() {
      if (timer) write();
      closed = true;
      listeners.clear();
    },
  };
}

/** Rejects actions a tab must not send, so a stale or hostile tab cannot fake a passing check. */
export function tabAction(state: OrchestrationState, value: unknown): Action | { error: string } {
  const action = value && typeof value === "object" ? (value as Action) : null;
  if (!action || typeof action.type !== "string") return { error: "Send an action with a type." };
  if (!TAB_ACTIONS.has(action.type)) return { error: `A tab cannot send ${action.type}; the server does that itself.` };
  if (action.type === "createProject") {
    const project = action.project;
    if (!project || typeof project.id !== "string" || !project.id || typeof project.name !== "string" || !project.name.trim() || typeof project.summary !== "string" || (project.repo !== undefined && (typeof project.repo !== "string" || !project.repo.trim()))) {
      return { error: "A project needs an id, name, summary and a repository path or workspace folder." };
    }
  }
  if (action.type === "readNotifications" && action.goalId !== undefined && (typeof action.goalId !== "string" || !state.goals.some((goal) => goal.id === action.goalId))) {
    return { error: "Choose a task whose activity to read." };
  }
  if (action.type === "updateTask") {
    const blocked = Object.keys(action.patch ?? {}).filter((key) => !EDITABLE.has(key));
    if (blocked.length) return { error: `A tab cannot change ${blocked.join(", ")} directly.` };
    if (action.patch?.pushBeforeRun !== undefined && typeof action.patch.pushBeforeRun !== "boolean") return { error: "pushBeforeRun must be true or false." };
  }
  if (action.type === "createGoal") {
    const goal = action.goal;
    if (goal && ["branch", "folder", "base", "blocker", "merged", "mergeRequestUrl"].some((key) => key in goal)) return { error: "A new task starts with no branch. Shepherd creates it when needed." };
    if (!goal || typeof goal.id !== "string" || !goal.id || typeof goal.name !== "string" || !goal.name.trim() || typeof goal.goal !== "string" || !state.projects.some((project) => project.id === goal.projectId)) {
      return { error: "A new task needs an id, name, goal text and a project." };
    }
  }
  if (action.type === "createGoal" && action.goal) {
    const goal = action.goal;
    if (goal.objectiveId !== undefined && !state.objectives.some((objective) => objective.id === goal.objectiveId && objective.projectId === goal.projectId && !objective.archived)) {
      return { error: "Make the graph in an open objective of the same repo." };
    }
    if (goal.color !== undefined && !isGraphColor(goal.color)) return { error: "Pick one of the graph colours." };
  }
  if (action.type === "createObjective") {
    const objective = action.objective;
    if (!objective || typeof objective.id !== "string" || !objective.id || typeof objective.name !== "string" || !objective.name.trim() || !state.projects.some((project) => project.id === objective.projectId)) {
      return { error: "A new objective needs an id, a name and a repo." };
    }
  }
  if (action.type === "updateObjective" && (!action.patch || Object.keys(action.patch).some((key) => key !== "name") || typeof action.patch.name !== "string" || !action.patch.name.trim())) {
    return { error: "A tab can only rename an objective, to a nonempty name." };
  }
  if (action.type === "moveGoal" && action.by !== -1 && action.by !== 1) return { error: "Move a graph up or down by one." };
  if (action.type === "updateGoal") {
    if (!action.patch || Object.keys(action.patch).some((key) => key !== "name" && key !== "goal" && key !== "color")) {
      return { error: "A tab can only edit a task's name, goal and colour directly." };
    }
    if (action.patch.color !== undefined && !isGraphColor(action.patch.color)) return { error: "Pick one of the graph colours." };
    if ((action.patch.name !== undefined && (typeof action.patch.name !== "string" || !action.patch.name.trim())) || (action.patch.goal !== undefined && typeof action.patch.goal !== "string")) {
      return { error: "Use a nonempty name and text for the task's goal." };
    }
  }
  if (action.type === "setWorkCheck" && typeof action.on !== "boolean") return { error: "on must be true or false." };
  if (action.type === "setCheck") {
    const check = state.tasks.find((task) => task.id === action.taskId)?.verification.find((item) => item.id === action.checkId);
    if (check && check.kind !== "review") return { error: "Only reviews are accepted or rejected by hand. Checks pass by running." };
  }
  const created =
    action.type === "createTask"
      ? [action.task]
      : action.type === "approvePlan"
        ? action.tasks
        : action.type === "addSteps"
          ? (action.steps ?? []).map((step) => step.task)
          : action.type === "fixIssue"
            ? [action.task]
            : [];
  if (created.some((task) => !task || task.git || task.acceptanceMarks || task.status === "running" || !Array.isArray(task.verification) || task.verification.some((check) => check.state !== "pending"))) {
    return { error: "A new task starts unverified, with no branch." };
  }
  if (created.some((task) => !state.goals.some((goal) => goal.id === task.goalId && goal.projectId === task.projectId))) {
    return { error: "A new step needs a task in its project, as goalId." };
  }
  if (action.type === "addSteps" && created.some((task) => task.goalId !== action.goalId)) {
    return { error: "Every new step must belong to the task receiving the steps." };
  }
  if (created.some((task) => (task.model !== undefined && !isModelId(task.model)) || (task.effort !== undefined && !isEffort(task.effort)))) {
    return { error: "That is not a model or thinking level an agent can use." };
  }
  if (created.some((task) => task.pushBeforeRun !== undefined && typeof task.pushBeforeRun !== "boolean")) return { error: "pushBeforeRun must be true or false." };
  return action;
}

export function envelope(state: OrchestrationState) {
  return { state: { state }, version: 3 };
}

function load(file: string, initial: OrchestrationState): OrchestrationState {
  if (!existsSync(file)) return initial;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    raw = undefined;
  }
  const saved = (raw as { state?: { state?: unknown } } | undefined)?.state?.state;
  const state = loadState(saved);
  if (state) {
    if ((saved as { schema?: number }).schema !== 3) {
      const before = path.join(path.dirname(file), "state.pre-tasks.json");
      if (!existsSync(before)) copyFileSync(file, before);
    }
    return state;
  }
  if (saved && typeof saved === "object" && Array.isArray((saved as { tasks?: unknown }).tasks)) {
    // Not the demo board and not readable: keep it rather than writing an empty board over it.
    const aside = `${file}.unreadable-${new Date(Date.now()).toISOString().replace(/[:.]/g, "-")}`;
    renameSync(file, aside);
    console.warn(`[shepherd] Could not read ${file}; moved it to ${aside} and started an empty board.`);
  }
  return workspace();
}

function taskCount(body: unknown): number {
  const tasks = (body as { state?: { state?: { tasks?: unknown } } } | null)?.state?.state?.tasks;
  return Array.isArray(tasks) ? tasks.length : 0;
}

/** Keeps a copy of the previous file every minute, and always before a write that drops tasks. */
function backup(file: string, next: OrchestrationState, lastAt: number, now: number): number {
  let previous: unknown;
  try {
    previous = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return lastAt;
  }
  const shrinking = next.tasks.length < taskCount(previous);
  if (!shrinking && now - lastAt < BACKUP_EVERY_MS) return lastAt;
  const dir = path.join(path.dirname(file), "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  writeFileSync(path.join(dir, `state-${stamp}.json`), JSON.stringify(previous));
  const stale = readdirSync(dir)
    .filter((name) => name.startsWith("state-"))
    .sort()
    .slice(0, -BACKUP_LIMIT);
  for (const name of stale) rmSync(path.join(dir, name));
  return now;
}
