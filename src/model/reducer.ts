import { blankGoal, commandCheck, reviewCheck, workCheck } from "./factory";
import { workCheckInput, workCheckPassed } from "./workCheck";
import { acceptanceItems, keptMarks } from "./acceptance";
import { EFFORT_LABEL, isEffort, isModelId } from "./models";
import { layoutGoal, normalize, outlineOf, syncOutlines } from "./outline";
import { agentById, projectDirectory, workspace } from "./workspace";
import { CHECK_LABEL } from "./types";
import type {
  Action,
  CheckRun,
  Dependency,
  Effort,
  ExecutionEvent,
  Gate,
  Goal,
  Look,
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
  "deleteGoal",
  "approvePlan",
  "createTask",
  "outdate",
  "refreshed",
  "setReview",
  "setWorkCheck",
  "startWorkCheck",
  "recordWorkCheck",
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
  "fixIssue",
]);

export function reducer(state: OrchestrationState, action: Action): OrchestrationState {
  let next = reduce(state, action);
  if (next === state) return state;
  const outline = OUTLINE_ACTIONS.has(action.type);
  if (outline) next = syncOutlines(next);
  if (outline || GATE_ACTIONS.has(action.type)) next = refreshGates(next);
  const goalId = laidOut(state, action);
  if (goalId && next.goals.find((goal) => goal.id === goalId)?.outline) next = layoutGoal(next, goalId);
  return next;
}

/** The task whose map follows its outline again after this action. */
function laidOut(state: OrchestrationState, action: Action): string | null {
  if (action.type === "addSteps" || action.type === "setOutline") return action.goalId;
  if (action.type === "followOutline" || action.type === "deleteTask" || action.type === "fixIssue") {
    return state.tasks.find((task) => task.id === action.id)?.goalId ?? null;
  }
  return null;
}

function reduce(state: OrchestrationState, action: Action): OrchestrationState {
  switch (action.type) {
    case "reset":
      return state.workspace ? { ...workspace(state.now), workspace: state.workspace } : workspace(state.now);
    case "dismissNotification":
      return { ...state, notifications: state.notifications.filter((item) => item.id !== action.id) };
    case "readNotifications": {
      const ids = action.goalId === undefined ? null : new Set(state.tasks.filter((task) => task.goalId === action.goalId).map((task) => task.id));
      const matches = (item: OrchestrationState["notifications"][number]) => !item.read && (!ids || !!item.taskId && ids.has(item.taskId));
      if (!state.notifications.some(matches)) return state;
      return { ...state, notifications: state.notifications.map((item) => matches(item) ? { ...item, read: true } : item) };
    }
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
    case "createGoal":
      return createGoal(state, action.goal);
    case "updateGoal": {
      const name = typeof action.patch?.name === "string" ? action.patch.name.trim() : "";
      return {
        ...state,
        goals: state.goals.map((goal) => goal.id === action.id
          ? { ...goal, ...(name ? { name } : {}), ...(typeof action.patch?.goal === "string" ? { goal: action.patch.goal.trim() } : {}) }
          : goal),
      };
    }
    case "goalRuntime":
      return { ...state, goals: state.goals.map((goal) => goal.id === action.id ? { ...goal, ...action.patch } : goal) };
    case "finishGoal":
    case "archiveGoal":
    case "reopenGoal":
      return {
        ...state,
        goals: state.goals.map((goal) => goal.id === action.id
          ? { ...goal, status: action.type === "finishGoal" ? "done" : action.type === "archiveGoal" ? "archived" : "open", running: false }
          : goal),
      };
    case "deleteGoal": {
      let next = state;
      for (const task of state.tasks.filter((task) => task.goalId === action.id)) next = deleteTask(next, task.id);
      return { ...next, goals: next.goals.filter((goal) => goal.id !== action.id) };
    }
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
      return addSteps(state, action.goalId, action.after, action.steps);
    case "setOutline":
      return setOutline(state, action.goalId, action.items);
    case "followOutline":
      return followOutline(state, action.id);
    case "setWorkCheck":
      return setWorkCheck(state, action.id, action.on);
    case "startWorkCheck":
      return startWorkCheck(state, action.taskId);
    case "recordWorkCheck":
      return recordWorkCheck(state, action);
    case "setReview":
      return setReview(state, action.id, action.on);
    case "setPlanRunning": {
      const goal = state.goals.find((item) => item.id === action.goalId);
      if (!goal || goal.status !== "open" || goal.running === action.running) return state;
      return { ...state, goals: state.goals.map((item) => item.id === goal.id ? { ...item, running: action.running } : item) };
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
    case "looked":
      return looked(state, action.id, action.look);
    case "markAcceptance": {
      const task = state.tasks.find((item) => item.id === action.id);
      if (!task || task.runner !== "agent" || task.status !== "running" || !acceptanceItems(task.acceptance).some((item) => item.key === action.key)) return state;
      const marks = { ...task.acceptanceMarks };
      if (action.note === null) delete marks[action.key];
      else if (action.note.trim()) marks[action.key] = { note: action.note.trim().slice(0, 500), at: state.now };
      else return state;
      return updateTask(state, task.id, { acceptanceMarks: marks });
    }
    case "noteIssue":
      return noteIssue(state, action.id, action.text);
    case "dropIssue":
      return dropIssue(state, action.id, action.issueId);
    case "fixIssue":
      return fixIssue(state, action.id, action.issueId, action.task);
    case "settleChecklist":
      return settleChecklist(state, action.id, action.use);
    case "setModel":
      return setModel(state, action.id, action.model, action.effort);
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
  if (!task || task.wired || !state.goals.find((goal) => goal.id === task.goalId)?.outline) return state;
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
  if (state.tasks.find((task) => task.id === source)?.goalId !== state.tasks.find((task) => task.id === target)?.goalId) return state;
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
    goals: [...state.goals, blankGoal(project.id, name)],
    projects: [
      ...state.projects,
      {
        id: project.id,
        name,
        summary: project.summary.trim(),
        ...(project.repo?.trim()
          ? { repo: project.repo.trim() }
          : { directory: project.directory?.trim() || projectDirectory(name, state.projects) }),
      },
    ],
  };
}

/**
 * Gives an older task, whose arrows were all drawn by hand, an outline in the order its steps
 * run. Its existing steps keep their arrows; only steps added from now on follow the outline.
 */
function adopt(state: OrchestrationState, goalId: string): OrchestrationState {
  const goal = state.goals.find((item) => item.id === goalId);
  if (!goal || goal.outline) return state;
  const outline = outlineOf(state, goalId);
  return {
    ...state,
    goals: state.goals.map((item) => (item.id === goalId ? { ...item, outline } : item)),
    tasks: state.tasks.map((task) => (task.goalId === goalId && !task.wired ? { ...task, wired: true } : task)),
  };
}

function withOutline(state: OrchestrationState, goalId: string, outline: OutlineItem[]): OrchestrationState {
  return { ...state, goals: state.goals.map((item) => (item.id === goalId ? { ...item, outline } : item)) };
}

function addSteps(
  state: OrchestrationState,
  goalId: string,
  after: string | null,
  steps: { task: Task; depth: number }[],
): OrchestrationState {
  const goal = state.goals.find((goal) => goal.id === goalId);
  if (!goal) return state;
  const known = new Set(state.tasks.map((task) => task.id));
  const fresh = steps.filter((step) => {
    if (step.task.goalId !== goalId || step.task.projectId !== goal.projectId || known.has(step.task.id)) return false;
    known.add(step.task.id);
    return true;
  });
  if (!fresh.length) return state;
  const base = adopt(state, goalId);
  const items = outlineOf(base, goalId);
  const found = after ? items.findIndex((item) => item.id === after) : -1;
  const at = after === null ? 0 : found >= 0 ? found + 1 : items.length;
  const inserted = fresh.map((step) => ({ id: step.task.id, depth: Math.max(0, Math.floor(step.depth) || 0) }));
  const outline = normalize([...items.slice(0, at), ...inserted, ...items.slice(at)]);
  const projectId = goal.projectId;
  const log = createLog(withOutline(base, goalId, outline), state.now);
  if (fresh.length > 1) {
    log.event({ taskId: fresh[0]!.task.id, projectId, message: `Added ${fresh.length} steps`, tone: "info" });
  }
  return log.finish({ tasks: [...base.tasks, ...fresh.map((step) => step.task)] });
}

function setOutline(state: OrchestrationState, goalId: string, items: OutlineItem[]): OrchestrationState {
  const goal = state.goals.find((item) => item.id === goalId);
  if (!goal || !Array.isArray(items)) return state;
  const ids = new Set(state.tasks.filter((task) => task.goalId === goalId).map((task) => task.id));
  const seen = new Set<string>();
  const listed: OutlineItem[] = [];
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !ids.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    listed.push({ id: item.id, depth: Number.isInteger(item.depth) ? item.depth : 0 });
  }
  const base = adopt(state, goalId);
  const outline = normalize([...listed, ...outlineOf(base, goalId).filter((item) => !seen.has(item.id))]);
  const current = base.goals.find((item) => item.id === goalId)!.outline ?? [];
  const same = current.length === outline.length && outline.every((item, index) => item.id === current[index]?.id && item.depth === current[index]?.depth);
  return same ? base : withOutline(base, goalId, outline);
}

/** Drops the arrows drawn by hand into a step, so it waits for what the outline says again. */
function followOutline(state: OrchestrationState, id: string): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return state;
  const base = adopt(state, task.goalId);
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
  if (!state.goals.some((goal) => goal.id === task.goalId && goal.projectId === task.projectId) || state.tasks.some((item) => item.id === task.id)) return state;
  const log = createLog(state, state.now);
  const known = new Set(state.tasks.filter((item) => item.goalId === task.goalId).map((item) => item.id));
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

/** Picks the model and thinking for an agent's step, or goes back to the agent's defaults. */
function setModel(state: OrchestrationState, id: string, model: string | null, effort: Effort | null): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || task.runner !== "agent" || task.status === "running") return state;
  if ((model !== null && !isModelId(model)) || (effort !== null && !isEffort(effort))) return state;
  if ((task.model ?? null) === model && (task.effort ?? null) === effort) return state;
  const { model: _model, effort: _effort, ...rest } = task;
  return { ...state, tasks: replaceTask(state.tasks, { ...rest, ...(model ? { model } : {}), ...(effort ? { effort } : {}) }) };
}

function settleChecklist(state: OrchestrationState, id: string, use: boolean): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task?.checklist) return state;
  const { checklist, ...rest } = task;
  return { ...state, tasks: replaceTask(state.tasks, use ? { ...rest, objective: checklist } : rest) };
}

function updateTask(state: OrchestrationState, id: string, patch: Partial<Task>): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return state;
  const nextPatch = { ...patch };
  delete nextPatch.id;
  delete nextPatch.projectId;
  delete nextPatch.goalId;
  delete nextPatch.status;
  delete nextPatch.agentId;
  delete nextPatch.checkCommand;
  const next = { ...task, ...nextPatch };
  next.acceptanceMarks = keptMarks(next.acceptance, next.acceptanceMarks, task.acceptance);
  if (workCheckInput(next) !== workCheckInput(task)) {
    next.verification = next.verification.map((check) => check.kind === "work" ? { ...workCheck(id) } : check);
    if (task.status === "failed" && task.verification.some((check) => check.kind === "work" && check.state === "failed")) {
      next.status = "completed";
      next.blocker = null;
    }
  }
  return { ...state, tasks: replaceTask(state.tasks, next) };
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
            result: undefined,
            timestamp: null,
            evidence: check.kind === "command" ? "Runs again when the agent finishes." : "A new run started. Review its output.",
          }))
        : task.verification,
    };
    const picked = task.runner === "agent" ? [task.model, task.effort ? `${EFFORT_LABEL[task.effort].toLowerCase()} thinking` : ""].filter(Boolean).join(", ") : "";
    log.event({
      taskId: task.id,
      projectId: task.projectId,
      message: `${rerun ? "Retrying" : "Started"} ${task.name}${picked ? ` with ${picked}` : ""}`,
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
    if (!task.verification.some((check) => check.kind === "work")) delete next.retries;
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
  if (agentById(nextAgent)?.provider !== agentById(task.agentId)?.provider) {
    // Another agent cannot resume this one's conversation, and has its own models.
    const { model: _model, effort: _effort, ...rest } = next;
    next = { ...rest, sessionId: null };
  }
  if (nextRunner !== task.runner) {
    const human = nextRunner === "human";
    next = {
      ...next,
      runner: nextRunner,
      verification: human ? task.verification.filter((check) => check.kind === "command") : task.verification,
      activity: task.status === "queued" ? (human ? "Waiting for you" : "Queued") : task.activity,
    };
    if (human) {
      delete next.autoRun;
      delete next.independent;
      delete next.pushBeforeRun;
    }
  }
  return log.finish({ tasks: replaceTask(state.tasks, next) });
}

function instruct(state: OrchestrationState, id: string, text: string): OrchestrationState {
  const trimmed = text.trim();
  const task = state.tasks.find((item) => item.id === id);
  if (!task || !trimmed) return state;
  const log = createLog(state, state.now);
  const next = { ...task, instructions: [...task.instructions, trimmed], verification: task.status === "failed" ? task.verification : task.verification.map((check) => check.kind === "work" ? workCheck(id) : check) };
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
  const checkFailed = task.verification.some((check) => check.kind !== "review" && check.state === "failed");
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
      check.kind !== "review"
        ? { ...check, result: undefined, state: "pending", running: false, timestamp: null, evidence: "Upstream work changed. Shepherd checks again after bringing it in." }
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

/** How many screenshots a step keeps. Older ones drop off. */
export const LOOK_LIMIT = 12;

function looked(state: OrchestrationState, id: string, look: Look): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return state;
  return { ...state, tasks: replaceTask(state.tasks, { ...task, looks: [...(task.looks ?? []), look].slice(-LOOK_LIMIT) }) };
}

const ISSUE_LIMIT = 2000;

function noteIssue(state: OrchestrationState, id: string, text: string): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  const trimmed = typeof text === "string" ? text.trim().slice(0, ISSUE_LIMIT) : "";
  if (!task || !trimmed) return state;
  const counted = { ...state, seq: state.seq + 1 };
  const issue = { id: `issue-${counted.seq}`, text: trimmed, at: state.now };
  const log = createLog(counted, state.now);
  log.event({ taskId: id, projectId: task.projectId, message: `Known issue in ${task.name}: ${trimmed}`, tone: "warning" });
  return log.finish({ tasks: replaceTask(state.tasks, { ...task, issues: [...(task.issues ?? []), issue] }) });
}

function dropIssue(state: OrchestrationState, id: string, issueId: string): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task?.issues?.some((issue) => issue.id === issueId)) return state;
  const issues = task.issues.filter((issue) => issue.id !== issueId);
  const next: Task = { ...task, issues };
  if (!issues.length) delete next.issues;
  return { ...state, tasks: replaceTask(state.tasks, next) };
}

/** Puts a step to fix the issue at the end of the outline, after everything else. */
function fixIssue(state: OrchestrationState, id: string, issueId: string, step: Task): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  const issue = task?.issues?.find((item) => item.id === issueId);
  if (!task || !issue || !step || step.goalId !== task.goalId || step.projectId !== task.projectId) return state;
  if (issue.stepId && state.tasks.some((item) => item.id === issue.stepId)) return state;
  const last = outlineOf(state, task.goalId).at(-1)?.id ?? null;
  const added = addSteps(state, task.goalId, last, [{ task: step, depth: 0 }]);
  if (added === state) return state;
  const current = added.tasks.find((item) => item.id === id)!;
  const issues = (current.issues ?? []).map((item) => (item.id === issueId ? { ...item, stepId: step.id } : item));
  return { ...added, tasks: replaceTask(added.tasks, { ...current, issues }) };
}

function approvePlan(state: OrchestrationState, tasks: Task[], dependencies: Dependency[]): OrchestrationState {
  const log = createLog(state, state.now);
  const known = new Set(state.tasks.map((task) => task.id));
  const fresh = tasks.filter((task) => !known.has(task.id) && state.goals.some((goal) => goal.id === task.goalId && goal.projectId === task.projectId));
  for (const task of fresh) known.add(task.id);
  const depIds = new Set(state.dependencies.map((dep) => dep.id));
  const byId = new Map([...state.tasks, ...fresh].map((task) => [task.id, task]));
  const freshDeps = dependencies.filter(
    (dep) => !depIds.has(dep.id) && known.has(dep.source) && known.has(dep.target) && dep.source !== dep.target && byId.get(dep.source)?.goalId === byId.get(dep.target)?.goalId,
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
  const unlink = (item: Task): Task =>
    item.issues?.some((issue) => issue.stepId === id)
      ? { ...item, issues: item.issues.map(({ stepId, ...issue }) => (stepId === id ? issue : { ...issue, ...(stepId ? { stepId } : {}) })) }
      : item;
  return log.finish({
    tasks: state.tasks.filter((item) => item.id !== id).map(unlink),
    dependencies: state.dependencies.filter((dep) => dep.source !== id && dep.target !== id),
    goals: state.goals.map((goal) =>
      goal.outline?.some((item) => item.id === id) ? { ...goal, outline: goal.outline.filter((item) => item.id !== id) } : goal,
    ),
  });
}

function createGoal(state: OrchestrationState, goal: Goal): OrchestrationState {
  if (!goal || !goal.id || (typeof goal.name !== "string" || !goal.name.trim()) || !state.projects.some((project) => project.id === goal.projectId) || state.goals.some((item) => item.id === goal.id)) return state;
  return { ...state, seq: state.seq + 1, goals: [...state.goals, blankGoal(goal.projectId, goal.name.trim(), goal.id, typeof goal.goal === "string" ? goal.goal.trim() : "")] };
}

function setWorkCheck(state: OrchestrationState, id: string, on: boolean): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || task.runner !== "agent" || task.status === "running" || task.verification.some((check) => check.running)) return state;
  if (task.verification.some((check) => check.kind === "work") === on) return state;
  const verification = on ? [...task.verification, workCheck(id)] : task.verification.filter((check) => check.kind !== "work");
  const recover = !on && task.status === "failed" && task.verification.some((check) => check.kind === "work" && check.state === "failed");
  return { ...state, tasks: replaceTask(state.tasks, { ...task, verification, ...(recover ? { status: "completed", blocker: null } : {}) }) };
}

function startWorkCheck(state: OrchestrationState, taskId: string): OrchestrationState {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task || task.runner !== "agent" || task.status !== "completed" || task.outdated || task.verification.some((check) => check.kind === "command" && check.state !== "passed")) return state;
  if (!task.verification.some((check) => check.kind === "work")) return state;
  return { ...state, tasks: replaceTask(state.tasks, { ...task, verification: task.verification.map((check) => check.kind === "work" ? { ...workCheck(taskId), running: true, evidence: "Codex is checking the work against this step…" } : check) }) };
}

function recordWorkCheck(state: OrchestrationState, action: Extract<Action, { type: "recordWorkCheck" }>): OrchestrationState {
  const task = state.tasks.find((item) => item.id === action.taskId);
  if (!task || task.status !== "completed" || task.outdated || !task.verification.some((check) => check.kind === "work" && check.running)) return state;
  const passed = !!action.result && workCheckPassed(action.result) && !action.failure;
  const evidence = action.failure ?? (passed ? "No unmet items or work against the step's instructions. Read each verdict below." : "The work did not meet this step. Retry sends the verdicts to the agent.");
  const next: Task = { ...task, verification: task.verification.map((check) => check.kind === "work" ? { ...check, state: passed ? "passed" : "failed", running: false, timestamp: state.now, evidence, result: action.result } : check) };
  if (passed) delete next.retries;
  else { next.status = "failed"; next.blocker = `The work check failed. ${evidence}`; next.activity = "Work check failed"; }
  const log = createLog(state, state.now);
  log.event({ taskId: task.id, projectId: task.projectId, message: `${task.name}: work check ${passed ? "passed" : "failed"}`, tone: passed ? "success" : "failure" });
  log.note({ taskId: task.id, message: passed ? `${task.name}: work check passed.` : `${task.name}: work check failed. ${evidence}`, tone: passed ? "success" : "failure" });
  return log.finish({ tasks: replaceTask(state.tasks, next) });
}
