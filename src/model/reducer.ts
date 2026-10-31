import { commandCheck, reviewCheck } from "./factory";
import { agentById, projectDirectory, workspace } from "./workspace";
import { CHECK_LABEL } from "./types";
import type { Action, CheckRun, Dependency, ExecutionEvent, Gate, Notification, OrchestrationState, Project, Task, TaskStatus } from "./types";
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
]);

export function reducer(state: OrchestrationState, action: Action): OrchestrationState {
  const next = reduce(state, action);
  return next !== state && GATE_ACTIONS.has(action.type) ? refreshGates(next) : next;
}

function reduce(state: OrchestrationState, action: Action): OrchestrationState {
  switch (action.type) {
    case "reset":
      return workspace(state.now);
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
      return { ...state, dependencies: state.dependencies.filter((dep) => dep.id !== action.id) };
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
      return reassign(state, action.id, action.agentId);
    case "instruct":
      return instruct(state, action.id, action.text);
    case "merged":
      return merged(state, action.id, action.into, action.sha);
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

function connect(state: OrchestrationState, source: string, target: string, gate: Gate | undefined): OrchestrationState {
  if (!source || !target || source === target) return state;
  const existing = state.dependencies.find((dep) => dep.source === source && dep.target === target);
  if (existing) {
    if (!gate || existing.gate === gate) return state;
    return {
      ...state,
      dependencies: state.dependencies.map((dep) => (dep.id === existing.id ? { ...dep, gate } : dep)),
    };
  }
  const ids = new Set(state.tasks.map((task) => task.id));
  if (!ids.has(source) || !ids.has(target)) return state;
  const id = state.dependencies.some((dep) => dep.id === `${source}->${target}`)
    ? `${source}->${target}-${state.seq + 1}`
    : `${source}->${target}`;
  return {
    ...state,
    seq: state.seq + 1,
    dependencies: [...state.dependencies, { id, source, target, gate: gate ?? "verified" }],
  };
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
      },
    ],
  };
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
    const rerun = task.status === "failed" || task.status === "completed";
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
    next = { ...next, blocker: null, startedAt: null, activity: "Cancelled" };
    log.event({ taskId: task.id, projectId: task.projectId, message: `Cancelled ${task.name}`, tone: "warning" });
  } else if (status === "completed") {
    const human = task.runner === "human";
    next = { ...next, blocker: null, activity: human ? "Signed off by you" : task.activity };
    log.event({
      taskId: task.id,
      projectId: task.projectId,
      message: human ? `${task.name} signed off` : `${task.name} reported complete`,
      tone: "success",
    });
    if (!human) {
      const reviewed = task.verification.some((check) => check.kind === "review");
      log.note({
        message: reviewed ? `${task.name} finished. Review it to verify.` : `${task.name} finished. Its check decides whether it is verified.`,
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
    log.note({ message: `${task.name} is verified.`, tone: "success", taskId });
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
  // An agent task verified by its check alone goes back to needing review when the check goes.
  const rest = !trimmed && task.runner === "agent" && !others.length ? [reviewCheck(task.id)] : others;
  const next: Task = {
    ...task,
    checkCommand: trimmed || undefined,
    verification: trimmed ? [commandCheck(task.id, trimmed), ...rest] : rest,
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
        ? { ...check, command, state: "pending", running: true, timestamp: null, evidence: `Running ${command}…` }
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
        }
      : check,
  );
  let next: Task = { ...task, verification };
  const human = task.runner === "human";
  if (passed) {
    if (task.blocker?.startsWith("The check failed")) {
      next = { ...next, status: "completed", blocker: null, activity: human ? "Signed off by you" : "Check passed" };
    }
    log.event({ taskId, projectId: task.projectId, message: `${task.name}: check passed`, tone: "success" });
    if (isFullyVerified(next)) log.note({ message: `${task.name} is verified.`, tone: "success", taskId });
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

function reassign(state: OrchestrationState, id: string, agentId: string | null): OrchestrationState {
  const task = state.tasks.find((item) => item.id === id);
  if (!task || task.agentId === agentId) return state;
  const log = createLog(state, state.now);
  const agent = agentById(agentId);
  log.event({
    taskId: id,
    projectId: task.projectId,
    message: agent ? `Reassigned ${task.name} to ${agent.name}` : `Unassigned ${task.name}`,
    tone: "info",
  });
  return log.finish({ tasks: replaceTask(state.tasks, { ...task, agentId }) });
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
  log.event({ taskId: id, projectId: task.projectId, message: `Deleted ${task.name}`, tone: "warning" });
  return log.finish({
    tasks: state.tasks.filter((item) => item.id !== id),
    dependencies: state.dependencies.filter((dep) => dep.source !== id && dep.target !== id),
  });
}
