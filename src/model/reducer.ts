import { commandCheck, reviewCheck } from "./factory";
import { layoutProject, normalize, outlineOf, syncOutlines } from "./outline";
import { agentById, projectDirectory, workspace } from "./workspace";
import { CHECK_LABEL } from "./types";
import type {
  Action,
  CheckRun,
  Dependency,
  ExecutionEvent,
  Gate,
  Notification,
  OrchestrationState,
  OutlineItem,
  Project,
  Runner,
  Task,
  TaskStatus,
} from "./types";
import { isFullyVerified, unmetDependencies } from "./verify";

function createLog(state: OrchestrationState, at: number) {
  let seq = state.seq;
  const events = state.events.slice();
  const notifications = state.notifications.slice();
  const event = (partial: Omit<ExecutionEvent, "id" | "at">) => {
    seq += 1;
    events.push({ ...partial, id: `evt-${seq}`, at });
  };
  const note = (partial: Omit<Notification, "id" | "at" | "read">) => {
    seq += 1;
    notifications.push({ ...partial, id: `ntf-${seq}`, at, read: false });
  };
  const finish = (
    rest: Partial<OrchestrationState> & Pick<OrchestrationState, "tasks">,
  ): OrchestrationState => ({
    ...state,
    ...rest,
    seq,
    events: events.slice(-80),
    notifications: notifications.slice(-24),
  });
  return { event, note, finish };
}

function replaceTask(tasks: Task[], task: Task): Task[] {
  return tasks.map((item) => (item.id === task.id ? task : item));
}

const GATE_ACTIONS = new Set<Action["type"]>([
  "connect",
  "disconnect",
  "setStatus",
  "setCheck",
  "setCheckCommand",
  "startCheck",
  "recordCheck",
  "deleteTask",
  "approvePlan",
  "createTask",
  "outdate",
  "refreshed",
  "setReview",
]);

/** Actions that can change what the outline implies, so its arrows are redrawn after them. */
const OUTLINE_ACTIONS = new Set<Action["type"]>([
  "addSteps",
  "setOutline",
  "followOutline",
  "connect",
  "disconnect",
  "createTask",
  "approvePlan",
  "deleteTask",
]);

export function reducer(state: OrchestrationState, action: Action): OrchestrationState {
  let next = reduce(state, action);
  if (next === state) return state;
  const outline = OUTLINE_ACTIONS.has(action.type);
  if (outline) next = syncOutlines(next);
  if (outline || GATE_ACTIONS.has(action.type)) next = refreshGates(next);
  const projectId = laidOut(state, action);
  if (projectId && next.projects.find((project) => project.id === projectId)?.outline) next = layoutProject(next, projectId);
  return next;
}

/** The project whose map follows its outline again after this action. */
function laidOut(state: OrchestrationState, action: Action): string | null {
  if (action.type === "addSteps" || action.type === "setOutline") return action.projectId;
  if (action.type === "followOutline" || action.type === "deleteTask") {
    return state.tasks.find((task) => task.id === action.id)?.projectId ?? null;
  }
  return null;
}

function reduce(state: OrchestrationState, action: Action): OrchestrationState {
  switch (action.type) {
    case "reset":
      return state.workspace ? { ...workspace(state.now), workspace: state.workspace } : workspace(state.now);
    case "dismissNotification":
      return { ...state, notifications: state.notifications.filter((item) => item.id !== action.id) };
    case "readNotifications":
      if (state.notifications.every((item) => item.read)) return state;
      return { ...state, notifications: state.notifications.map((item) => (item.read ? item : { ...item, read: true })) };
    case "moveTask": {
      const current = state.tasks.find((task) => task.id === action.id);
      if (!current || (current.position.x === action.position.x && current.position.y === action.position.y)) return state;
      return {
        ...state,
        tasks: state.tasks.map((task) => (task.id === action.id ? { ...task, position: action.position } : task)),
      };
    }
    case "connect":
      return connect(state, action.source, action.target, action.gate);
    case "disconnect":
      return disconnect(state, action.id);
    case "createProject":
      return createProject(state, action.project);
    case "createTask":
      return createTask(state, action.task, action.dependsOn ?? []);
    case "updateTask":
      return updateTask(state, action.id, action.patch);
    case "setStatus":
      return setStatus(state, action.id, action.status);
    case "setCheck":
      return setCheck(state, action.taskId, action.checkId, action.state);
    case "setCheckCommand":
      return setCheckCommand(state, action.id, action.command);
    case "startCheck":
      return startCheck(state, action.taskId);
    case "recordCheck":
      return recordCheck(state, action.taskId, action.run);
    case "reassign":
      return reassign(state, action.id, action.agentId, action.runner);
    case "addSteps":
      return addSteps(state, action.projectId, action.after, action.steps);
    case "setOutline":
      return setOutline(state, action.projectId, action.items);
    case "followOutline":
      return followOutline(state, action.id);
    case "setReview":
      return setReview(state, action.id, action.on);
    case "setPlanRunning": {
      const project = state.projects.find((item) => item.id === action.projectId);
      if (!project || !!project.running === action.running) return state;
      const { running: _was, ...rest } = project;
      const next: Project = action.running ? { ...rest, running: true } : rest;
      return { ...state, projects: state.projects.map((item) => (item.id === project.id ? next : item)) };
    }
    case "instruct":
      return instruct(state, action.id, action.text);
    case "merged":
      return merged(state, action.id, action.into, action.sha);
    case "setWorkspace": {
      const path = action.path.trim();
      if ((state.workspace ?? "") === path) return state;
      const { workspace: _previous, ...rest } = state;
      return path ? { ...rest, workspace: path } : rest;
    }
    case "outdate":
      return outdate(state, action.id, action.reason);
    case "refreshed":
      return refreshed(state, action);
    case "approvePlan":
      return approvePlan(state, action.tasks, action.dependencies);
    case "deleteTask":
      return deleteTask(state, action.id);
    default:
      return state;
  }
}

function refreshGates(state: OrchestrationState): OrchestrationState {
  const log = createLog(state, state.now);
  let changed = false;
  const tasks = state.tasks.map((task) => {
    if (!task.gated) return task;
    const unmet = unmetDependencies(task.id, state.tasks, state.dependencies);
    if (unmet.length) {
      const blocker = unmet.join(". ");
      if (blocker === task.blocker) return task;
      changed = true;
      return { ...task, blocker };
    }
    const human = task.runner === "human";
    log.event({ taskId: task.id, projectId: task.projectId, message: `${task.name} is ready`, tone: "success" });
    log.note({
      message: human ? `${task.name} is ready for you.` : `${task.name} is ready to run.`,
      tone: "info",
      taskId: task.id,
    });
    changed = true;
    return {
      ...task,
      gated: false,
      blocker: null,
      status: task.status === "blocked" ? ("queued" as const) : task.status,
      activity: human ? "Ready for you" : "Ready to run",
    };
  });
  return changed ? log.finish({ tasks }) : state;
}

/**
 * A step whose arrows you change on the map keeps the arrows it has, as its own, and the outline
 * stops deciding what it waits for.
 */
function wireByHand(state: OrchestrationState, taskId: string): OrchestrationState {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || task.wired || !state.projects.find((project) => project.id === task.projectId)?.outline) return state;
  return {
    ...state,
    tasks: replaceTask(state.tasks, { ...task, wired: true }),
    dependencies: state.dependencies.map((dep) => {
      if (!dep.outline || dep.target !== taskId) return dep;
      const { outline: _drawn, ...own } = dep;
      return own;
    }),
  };
}

function connect(state: OrchestrationState, source: string, target: string, gate: Gate | undefined): OrchestrationState {
  if (!source || !target || source === target) return state;
  const ids = new Set(state.tasks.map((task) => task.id));
  if (!ids.has(source) || !ids.has(target)) return state;
  const existing = state.dependencies.find((dep) => dep.source === source && dep.target === target);
  if (existing && (!gate || existing.gate === gate)) return state;
  const wired = wireByHand(state, target);
  if (existing) {
    return {
      ...wired,
      dependencies: wired.dependencies.map((dep) => (dep.id === existing.id ? { ...dep, gate: gate! } : dep)),
    };
  }
  const id = wired.dependencies.some((dep) => dep.id === `${source}->${target}`)
    ? `${source}->${target}-${wired.seq + 1}`
    : `${source}->${target}`;
  return {
    ...wired,
    seq: wired.seq + 1,
    dependencies: [...wired.dependencies, { id, source, target, gate: gate ?? "verified" }],
  };
}

function disconnect(state: OrchestrationState, id: string): OrchestrationState {
  const dep = state.dependencies.find((item) => item.id === id);
  if (!dep) return state;
  const wired = wireByHand(state, dep.target);
  return { ...wired, dependencies: wired.dependencies.filter((item) => item.id !== id) };
}

function createProject(state: OrchestrationState, project: Project): OrchestrationState {
  const name = project.name.trim();
  if (!name || state.projects.some((item) => item.id === project.id)) return state;
  return {
    ...state,
    seq: state.seq + 1,
    projects: [
      ...state.projects,
      {
        id: project.id,
        name,
        summary: project.summary.trim(),
        directory: project.directory?.trim() || projectDirectory(name, state.projects),
        outline: [],
      },
    ],
  };
}

/**
 * Gives an older project, whose arrows were all drawn by hand, an outline in the order its steps
 * run. Its existing steps keep their arrows; only steps added from now on follow the outline.
 */
function adopt(state: OrchestrationState, projectId: string): OrchestrationState {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project || project.outline) return state;
  const outline = outlineOf(state, projectId);
  return {
    ...state,
    projects: state.projects.map((item) => (item.id === projectId ? { ...item, outline } : item)),
    tasks: state.tasks.map((task) => (task.projectId === projectId && !task.wired ? { ...task, wired: true } : task)),
  };
}

function withOutline(state: OrchestrationState, projectId: string, outline: OutlineItem[]): OrchestrationState {
  return { ...state, projects: state.projects.map((item) => (item.id === projectId ? { ...item, outline } : item)) };
}

function addSteps(
  state: OrchestrationState,
  projectId: string,
  after: string | null,
  steps: { task: Task; depth: number }[],
): OrchestrationState {
  const known = new Set(state.tasks.map((task) => task.id));
  const fresh = steps.filter((step) => step.task.projectId === projectId && !known.has(step.task.id));
  if (!fresh.length || !state.projects.some((project) => project.id === projectId)) return state;
  const base = adopt(state, projectId);
  const items = outlineOf(base, projectId);
  const found = after ? items.findIndex((item) => item.id === after) : -1;
  const at = after === null ? 0 : found >= 0 ? found + 1 : items.length;
  const inserted = fresh.map((step) => ({ id: step.task.id, depth: Math.max(0, Math.floor(step.depth) || 0) }));
  const outline = normalize([...items.slice(0, at), ...inserted, ...items.slice(at)]);
  const log = createLog(withOutline(base, projectId, outline), state.now);
  if (fresh.length > 1) {
    log.event({ taskId: fresh[0]!.task.id, projectId, message: `Added ${fresh.length} steps`, tone: "info" });
  }
  return log.finish({ tasks: [...base.tasks, ...fresh.map((step) => step.task)] });
}

function setOutline(state: OrchestrationState, projectId: string, items: OutlineItem[]): OrchestrationState {
  const project = state.projects.find((item) => item.id === projectId);
  if (!project || !Array.isArray(items)) return state;
  const ids = new Set(state.tasks.filter((task) => task.projectId === projectId).map((task) => task.id));
  const seen = new Set<string>();
  const listed: OutlineItem[] = [];
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !ids.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    listed.push({ id: item.id, depth: Number.isInteger(item.depth) ? item.depth : 0 });
  }
  const base = adopt(state, projectId);
  const outline = normalize([...listed, ...outlineOf(base, projectId).filter((item) => !seen.has(item.id))]);
  const current = base.projects.find((item) => item.id === projectId)!.outline ?? [];
  const same = current.length === outline.length && outline.every((item, index) => item.id === current[index]?.id && item.depth === current[index]?.depth);
  return same ? base : withOutline(base, projectId, outline);
}

/** Drops the arrows drawn by hand into a step, so it waits for what the outline says again. */
function followOutline(state: OrchestrationState, id: string): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return state;
  const base = adopt(state, task.projectId);
  const current = base.tasks.find((item) => item.id === id)!;
  const own = base.dependencies.some((dep) => dep.target === id && !dep.outline);
  if (!current.wired && !own) return base;
  const { wired: _byHand, ...rest } = current;
  return {
    ...base,
    tasks: replaceTask(base.tasks, rest),
    dependencies: base.dependencies.filter((dep) => dep.target !== id || dep.outline),
  };
}

/** Turns on or off your look at an agent step's work before the steps after it start. */
function setReview(state: OrchestrationState, id: string, on: boolean): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || task.runner !== "agent" || task.status === "running") return state;
  const has = task.verification.some((check) => check.kind === "review");
  if (has === on) return state;
  const log = createLog(state, state.now);
  const verification = on ? [...task.verification, reviewCheck(id)] : task.verification.filter((check) => check.kind !== "review");
  log.event({
    taskId: id,
    projectId: task.projectId,
    message: on ? `You review ${task.name} before what comes after it starts` : `${task.name} no longer waits for your review`,
    tone: "info",
  });
  return log.finish({ tasks: replaceTask(state.tasks, { ...task, verification }) });
}

function createTask(
  state: OrchestrationState,
  task: Task,
  dependsOn: { source: string; gate?: Dependency["gate"] }[],
): OrchestrationState {
  if (state.tasks.some((item) => item.id === task.id)) return state;
  const log = createLog(state, state.now);
  const known = new Set(state.tasks.map((item) => item.id));
  const dependencies = [
    ...state.dependencies,
    ...dependsOn
      .filter((dep) => dep.source !== task.id && known.has(dep.source))
      .map((dep) => ({
        id: `${dep.source}->${task.id}`,
        source: dep.source,
        target: task.id,
        gate: dep.gate ?? "verified",
      })),
  ];
  log.event({ taskId: task.id, projectId: task.projectId, message: `Created ${task.name}`, tone: "info" });
  return log.finish({ tasks: [...state.tasks, task], dependencies });
}

function updateTask(state: OrchestrationState, id: string, patch: Partial<Task>): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return state;
  const nextPatch = { ...patch };
  delete nextPatch.id;
  delete nextPatch.projectId;
  delete nextPatch.status;
  delete nextPatch.agentId;
  delete nextPatch.checkCommand;
  return { ...state, tasks: replaceTask(state.tasks, { ...task, ...nextPatch }) };
}

function setStatus(state: OrchestrationState, id: string, status: TaskStatus): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || task.status === status) return state;
  const log = createLog(state, state.now);
  const unmet = unmetDependencies(id, state.tasks, state.dependencies);
  const finish = (next: Task) => log.finish({ tasks: replaceTask(state.tasks, next) });

  if (unmet.length && task.status !== "running" && (status === "running" || status === "completed")) {
    const blocker = unmet.join(". ");
    const verb = status === "completed" ? "cannot be completed" : "cannot start";
    log.event({ taskId: task.id, projectId: task.projectId, message: `${task.name} ${verb}. ${blocker}`, tone: "warning" });
    log.note({ message: `${task.name} ${verb}. ${blocker}`, tone: "warning", taskId: task.id });
    return finish({ ...task, status: status === "completed" ? task.status : "blocked", blocker, gated: true });
  }

  let next: Task = { ...task, status, gated: false };
  if (task.status === "running" && task.startedAt != null) next.elapsedMs = Math.max(0, state.now - task.startedAt);
  if (status === "running") {
    const rerun = task.status === "failed" || task.status === "completed" || !!task.outdated;
    delete next.outdated;
    if (next.git?.merged) {
      const { merged: _landed, ...git } = next.git;
      next.git = git;
    }
    next = {
      ...next,
      blocker: null,
      startedAt: rerun ? state.now : (task.startedAt ?? state.now),
      activity: rerun ? "Retrying" : "Started",
      verification: rerun
        ? task.verification.map((check) => ({
            ...check,
            state: "pending" as const,
            running: false,
            timestamp: null,
            evidence: check.kind === "command" ? "Runs again when the agent finishes." : "A new run started. Review its output.",
          }))
        : task.verification,
    };
    log.event({
      taskId: task.id,
      projectId: task.projectId,
      message: rerun ? `Retrying ${task.name}` : `Started ${task.name}`,
      tone: "info",
    });
  } else if (status === "blocked") {
    next = { ...next, blocker: task.status === "running" ? "Paused by you" : task.blocker };
    log.event({ taskId: task.id, projectId: task.projectId, message: `Paused ${task.name}`, tone: "warning" });
  } else if (status === "queued") {
    const again = task.status === "failed";
    next = { ...next, blocker: null, startedAt: null, activity: again ? "Trying again" : "Cancelled" };
    log.event({ taskId: task.id, projectId: task.projectId, message: again ? `Trying ${task.name} again` : `Cancelled ${task.name}`, tone: again ? "info" : "warning" });
  } else if (status === "completed") {
    const human = task.runner === "human";
    next = { ...next, blocker: null, activity: human ? "Signed off by you" : task.activity };
    log.event({
      taskId: task.id,
      projectId: task.projectId,
      message: human ? `${task.name} signed off` : `${task.name} reported complete`,
      tone: "success",
    });
    if (!human && task.verification.length) {
      const reviewed = task.verification.some((check) => check.kind === "review");
      log.note({
        message: reviewed ? `${task.name} finished. Review it before what comes next starts.` : `${task.name} finished. Its check decides whether it is done.`,
        tone: "success",
        taskId: task.id,
      });
    }
  } else if (status === "failed") {
    next = { ...next, blocker: task.blocker ?? "Marked failed" };
    log.event({ taskId: task.id, projectId: task.projectId, message: `${task.name} failed`, tone: "failure" });
    log.note({ message: `${task.name} failed.`, tone: "failure", taskId: task.id });
  }

  return finish(next);
}

function reviewedPaths(task: Task): string {
  const paths = task.filesChanged;
  if (!paths.length) return "";
  const shown = paths.slice(0, 4).join(", ");
  return paths.length > 4 ? `${shown} and ${paths.length - 4} more` : shown;
}

function setCheck(
  state: OrchestrationState,
  taskId: string,
  checkId: string,
  checkState: "passed" | "failed" | "pending",
): OrchestrationState {
  const task = state.tasks.find((item) => item.id === taskId);
  const target = task?.verification.find((check) => check.id === checkId);
  if (!task || !target || target.state === checkState) return state;
  const log = createLog(state, state.now);
  const paths = reviewedPaths(task);
  const evidence =
    checkState === "passed"
      ? paths
        ? `Accepted by you after reviewing ${paths}.`
        : "Accepted by you."
      : checkState === "failed"
        ? paths
          ? `Rejected by you after reviewing ${paths}.`
          : "Rejected by you."
        : "Reopened by you.";
  const verification = task.verification.map((check) =>
    check.id === checkId
      ? { ...check, state: checkState, evidence, timestamp: checkState === "pending" ? null : state.now }
      : check,
  );
  let next: Task = { ...task, verification };
  const label = CHECK_LABEL[target.kind];
  const tone = checkState === "passed" ? "success" : checkState === "failed" ? "failure" : "info";
  log.event({
    taskId,
    projectId: task.projectId,
    message: `${task.name}: ${label} ${checkState === "passed" ? "accepted" : checkState === "failed" ? "rejected" : "reopened"}`,
    tone,
  });
  if (checkState === "passed" && isFullyVerified(next)) {
    log.note({ message: `${task.name} is done.`, tone: "success", taskId });
  }
  if (checkState === "failed") {
    if (task.status === "completed" && task.runner === "agent") {
      next = {
        ...next,
        status: "failed",
        blocker: `You rejected the ${label.toLowerCase()}. Retry it with an instruction.`,
        activity: "Rejected by you",
      };
    }
    log.note({ message: `${task.name} was rejected.`, tone: "failure", taskId });
  }
  return log.finish({ tasks: replaceTask(state.tasks, next) });
}

function setCheckCommand(state: OrchestrationState, id: string, command: string): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  const trimmed = command.trim();
  if (!task || (task.checkCommand ?? "") === trimmed) return state;
  const log = createLog(state, state.now);
  const others = task.verification.filter((check) => check.kind !== "command");
  const next: Task = {
    ...task,
    checkCommand: trimmed || undefined,
    verification: trimmed ? [commandCheck(task.id, trimmed), ...others] : others,
  };
  log.event({
    taskId: id,
    projectId: task.projectId,
    message: trimmed ? `Check for ${task.name}: ${trimmed}` : `Removed the check for ${task.name}`,
    tone: "info",
  });
  return log.finish({ tasks: replaceTask(state.tasks, next) });
}

function startCheck(state: OrchestrationState, taskId: string): OrchestrationState {
  const task = state.tasks.find((item) => item.id === taskId);
  const command = task?.checkCommand;
  if (!task || !command || !task.verification.some((check) => check.kind === "command")) return state;
  const next: Task = {
    ...task,
    verification: task.verification.map((check) =>
      check.kind === "command"
        ? {
            ...check,
            command,
            state: "pending",
            running: true,
            timestamp: null,
            evidence: `Running ${command}…`,
            steps: undefined,
            artifacts: undefined,
          }
        : check,
    ),
  };
  return { ...state, tasks: replaceTask(state.tasks, next) };
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

const OUTPUT_LIMIT = 6000;

function recordCheck(state: OrchestrationState, taskId: string, run: CheckRun): OrchestrationState {
  const task = state.tasks.find((item) => item.id === taskId);
  const target = task?.verification.find((check) => check.kind === "command");
  if (!task || !target?.running || run.command !== task.checkCommand) return state;
  const log = createLog(state, state.now);
  const passed = run.exitCode === 0 && !run.timedOut;
  const evidence = run.timedOut
    ? `${run.command} timed out after ${seconds(run.durationMs)}.`
    : run.exitCode == null
      ? `${run.command} could not run.`
      : `${run.command} exited ${run.exitCode} in ${seconds(run.durationMs)}.`;
  const verification = task.verification.map((check) =>
    check.id === target.id
      ? {
          ...check,
          state: passed ? ("passed" as const) : ("failed" as const),
          running: false,
          timestamp: state.now,
          evidence,
          exitCode: run.timedOut ? null : run.exitCode,
          output: run.output.length > OUTPUT_LIMIT ? `…${run.output.slice(-OUTPUT_LIMIT)}` : run.output,
          durationMs: run.durationMs,
          steps: run.steps?.length ? run.steps : undefined,
          artifacts: run.artifacts?.length ? run.artifacts : undefined,
        }
      : check,
  );
  let next: Task = { ...task, verification };
  const human = task.runner === "human";
  if (passed) {
    delete next.retries;
    if (task.blocker?.startsWith("The check failed")) {
      next = { ...next, status: "completed", blocker: null, activity: human ? "Signed off by you" : "Check passed" };
    }
    log.event({ taskId, projectId: task.projectId, message: `${task.name}: check passed`, tone: "success" });
    if (isFullyVerified(next)) log.note({ message: `${task.name} is done.`, tone: "success", taskId });
  } else {
    if (task.status === "completed") {
      next = {
        ...next,
        status: human ? "queued" : "failed",
        blocker: human
          ? `The check failed. ${evidence}`
          : `The check failed. ${evidence} Retry sends its output to the agent.`,
        activity: "Check failed",
      };
    }
    log.event({ taskId, projectId: task.projectId, message: `${task.name}: check failed`, tone: "failure" });
    log.note({ message: `${task.name}: the check failed. ${evidence}`, tone: "failure", taskId });
  }
  return log.finish({ tasks: replaceTask(state.tasks, next) });
}

/** Hands a step to another agent, or to you. Who does it is fixed once it has a branch. */
function reassign(state: OrchestrationState, id: string, agentId: string | null, runner: Runner | undefined): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return state;
  const nextRunner = runner === "human" || runner === "agent" ? runner : task.runner;
  const nextAgent = nextRunner === "human" ? null : agentId;
  if (task.agentId === nextAgent && task.runner === nextRunner) return state;
  if (nextRunner !== task.runner && (task.status === "running" || task.git)) return state;
  const log = createLog(state, state.now);
  const agent = agentById(nextAgent);
  log.event({
    taskId: id,
    projectId: task.projectId,
    message: nextRunner === "human" ? `You do ${task.name}` : agent ? `Gave ${task.name} to ${agent.name}` : `Unassigned ${task.name}`,
    tone: "info",
  });
  let next: Task = { ...task, agentId: nextAgent };
  if (nextRunner !== task.runner) {
    const human = nextRunner === "human";
    next = {
      ...next,
      runner: nextRunner,
      verification: human ? task.verification.filter((check) => check.kind !== "review") : task.verification,
      activity: task.status === "queued" ? (human ? "Waiting for you" : "Queued") : task.activity,
    };
    if (human) {
      delete next.autoRun;
      delete next.independent;
    }
  }
  return log.finish({ tasks: replaceTask(state.tasks, next) });
}

function instruct(state: OrchestrationState, id: string, text: string): OrchestrationState {
  const trimmed = text.trim();
  const task = state.tasks.find((item) => item.id === id);
  if (!task || !trimmed) return state;
  const log = createLog(state, state.now);
  const next = { ...task, instructions: [...task.instructions, trimmed] };
  log.event({ taskId: id, projectId: task.projectId, message: `Instruction sent to ${task.name}`, tone: "info" });
  return log.finish({ tasks: replaceTask(state.tasks, next) });
}

function merged(state: OrchestrationState, id: string, into: string, sha: string): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task?.git) return state;
  const log = createLog(state, state.now);
  log.event({ taskId: id, projectId: task.projectId, message: `Merged ${task.name} into ${into}`, tone: "success" });
  log.note({ message: `${task.name} is merged into ${into}.`, tone: "success", taskId: id });
  const next: Task = { ...task, git: { ...task.git, merged: { into, sha, at: state.now } } };
  return log.finish({ tasks: replaceTask(state.tasks, next) });
}

/**
 * Upstream work changed after this task ran, so its check result no longer counts. A running task
 * only remembers why; Shepherd refreshes it when the run ends.
 */
function outdate(state: OrchestrationState, id: string, reason: string): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task?.git) return state;
  if (task.runner === "human") {
    if (task.status !== "completed" && task.status !== "queued") return state;
    const log = createLog(state, state.now);
    log.event({ taskId: id, projectId: task.projectId, message: `${task.name} is out of date: ${reason}`, tone: "warning" });
    return log.finish({ tasks: replaceTask(state.tasks, { ...task, status: "queued", outdated: reason, activity: `Out of date: ${reason}` }) });
  }
  if (task.status === "running") return { ...state, tasks: replaceTask(state.tasks, { ...task, outdated: reason }) };
  const checkFailed = task.verification.some((check) => check.kind === "command" && check.state === "failed");
  if (task.status !== "completed" && !(task.status === "failed" && checkFailed)) return state;
  const log = createLog(state, state.now);
  log.event({ taskId: id, projectId: task.projectId, message: `${task.name} is out of date: ${reason}`, tone: "warning" });
  const next: Task = {
    ...task,
    status: "queued",
    outdated: reason,
    blocker: null,
    activity: `Out of date: ${reason}`,
    verification: task.verification.map((check) =>
      check.kind === "command"
        ? { ...check, state: "pending", running: false, timestamp: null, evidence: "Upstream work changed. Shepherd checks again after bringing it in." }
        : check,
    ),
  };
  return log.finish({ tasks: replaceTask(state.tasks, next) });
}

/** Shepherd merged new upstream work into an out-of-date task's branch without rerunning its agent. */
function refreshed(state: OrchestrationState, action: Extract<Action, { type: "refreshed" }>): OrchestrationState {
  const task = state.tasks.find((item) => item.id === action.id);
  if (!task?.git) return state;
  const log = createLog(state, state.now);
  const brought = action.merged.length ? `Brought in ${action.merged.join(", ")}` : "Already had the upstream work";
  const human = task.runner === "human";
  const activity = human
    ? `${brought}. Check the result in this step's folder.`
    : action.keepReview
      ? `${brought}. Its own changes are the same.`
      : `${brought}. Its own changes differ now, so it needs review again.`;
  log.event({ taskId: task.id, projectId: task.projectId, message: `${task.name}: ${brought.toLowerCase()}`, tone: "info" });
  const moved = task.git.head !== action.head;
  const { merged: landed, ...git } = task.git;
  const next: Task = {
    ...task,
    status: human ? "queued" : "completed",
    blocker: null,
    activity,
    filesChanged: action.filesChanged,
    previews: action.previews,
    git: { ...git, head: action.head, ...(landed && !moved ? { merged: landed } : {}) },
    verification: task.verification.map((check) =>
      check.kind === "review" && !action.keepReview
        ? { ...check, state: "pending", timestamp: null, evidence: "Its diff changed after upstream work came in. Review it again." }
        : check,
    ),
  };
  delete next.outdated;
  return log.finish({ tasks: replaceTask(state.tasks, next) });
}

function approvePlan(state: OrchestrationState, tasks: Task[], dependencies: Dependency[]): OrchestrationState {
  const log = createLog(state, state.now);
  const known = new Set(state.tasks.map((task) => task.id));
  const fresh = tasks.filter((task) => !known.has(task.id));
  for (const task of fresh) known.add(task.id);
  const depIds = new Set(state.dependencies.map((dep) => dep.id));
  const freshDeps = dependencies.filter(
    (dep) => !depIds.has(dep.id) && known.has(dep.source) && known.has(dep.target) && dep.source !== dep.target,
  );
  if (fresh[0]) {
    log.event({
      taskId: fresh[0].id,
      projectId: fresh[0].projectId,
      message: `Approved a plan with ${fresh.length} tasks`,
      tone: "success",
    });
    log.note({
      message: `Plan added to the canvas (${fresh.length} tasks).`,
      tone: "success",
      taskId: fresh[0].id,
    });
  }
  return log.finish({
    tasks: [...state.tasks, ...fresh],
    dependencies: [...state.dependencies, ...freshDeps],
  });
}

function deleteTask(state: OrchestrationState, id: string): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return state;
  const log = createLog(state, state.now);
  if (task.name) log.event({ taskId: id, projectId: task.projectId, message: `Deleted ${task.name}`, tone: "warning" });
  return log.finish({
    tasks: state.tasks.filter((item) => item.id !== id),
    dependencies: state.dependencies.filter((dep) => dep.source !== id && dep.target !== id),
    projects: state.projects.map((project) =>
      project.outline?.some((item) => item.id === id) ? { ...project, outline: project.outline.filter((item) => item.id !== id) } : project,
    ),
  });
}
