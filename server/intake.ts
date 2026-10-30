import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { blankTask, nextPosition, slugify } from "../src/model/factory";
import { reducer } from "../src/model/reducer";
import { GATE_LABEL, type Action, type Gate, type OrchestrationState, type Project, type Runner } from "../src/model/types";
import { isFullyVerified } from "../src/model/verify";
import { AGENTS, agentById } from "../src/model/workspace";

export const MAX_TASKS = 50;

export interface Planned {
  projectId: string;
  tasks: { id: string; name: string }[];
  actions: Action[];
}

class Invalid extends Error {}

function fail(message: string): never {
  throw new Invalid(message);
}

/**
 * Turns an API request into the createTask actions the New task dialog would dispatch.
 * Dependencies can name tasks already on the board or earlier tasks in the same request.
 */
export function planTasks(state: OrchestrationState, body: unknown, newId: (index: number) => string): Planned | { error: string } {
  try {
    return plan(state, body, newId);
  } catch (error) {
    if (error instanceof Invalid) return { error: error.message };
    throw error;
  }
}

function plan(state: OrchestrationState, body: unknown, newId: (index: number) => string): Planned {
  const raw = record(body) ?? fail("Send a JSON object.");
  const project = findProject(state, raw.project);
  const batch = Array.isArray(raw.tasks);
  const items: unknown[] = batch ? (raw.tasks as unknown[]) : [raw];
  if (!items.length) fail("There are no tasks to add.");
  if (items.length > MAX_TASKS) fail(`Add at most ${MAX_TASKS} tasks at a time.`);

  let scratch = state;
  const tasks: Planned["tasks"] = [];
  const actions: Action[] = [];
  items.forEach((item, index) => {
    const where = batch ? `tasks[${index}]` : "The task";
    const field = (key: string) => (batch ? `${where}.${key}` : key);
    const request = record(item) ?? fail(`${where} must be an object.`);
    const name = text(request.name, field("name")) || fail(`${where} needs a name.`);
    const runner = runnerFor(request.runner, field("runner"));
    const dependsOn = dependencies(scratch, project.id, request.dependsOn, where, field("dependsOn"));
    const id = newId(index);
    const task = blankTask({
      id,
      projectId: project.id,
      name,
      objective: text(request.objective, field("objective")) || name,
      description: text(request.description, field("description")),
      acceptance: lines(request.acceptance, field("acceptance")),
      checkCommand: text(request.checkCommand, field("checkCommand")),
      runner,
      agentId: runner === "human" ? null : agentFor(request.agent, field("agent")),
      worktree: freeWorktree(scratch, project.id, name),
      position: nextPosition(scratch.tasks, project.id, dependsOn.map((dep) => dep.source)),
    });
    const action: Action = { type: "createTask", task, dependsOn };
    scratch = reducer(scratch, action);
    actions.push(action);
    tasks.push({ id, name });
  });
  return { projectId: project.id, tasks, actions };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") fail(`${field} must be a string.`);
  return value.trim();
}

function lines(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((line) => typeof line !== "string")) fail(`${field} must be a list of strings.`);
  return (value as string[]).map((line) => line.trim()).filter(Boolean);
}

function findProject(state: OrchestrationState, value: unknown): Project {
  const names = state.projects.map((project) => `${project.name} (${project.id})`).join(", ");
  const key = text(value, "project");
  if (!key) fail(`Say which project, by id or name. Projects: ${names}.`);
  const byId = state.projects.find((project) => project.id === key);
  if (byId) return byId;
  const byName = state.projects.filter((project) => project.name.toLowerCase() === key.toLowerCase());
  if (byName.length > 1) fail(`More than one project is named ${key}. Use its id: ${byName.map((project) => project.id).join(", ")}.`);
  return byName[0] ?? fail(`There is no project ${key}. Projects: ${names}.`);
}

function runnerFor(value: unknown, field: string): Runner {
  if (value === undefined || value === null) return "agent";
  if (value === "agent" || value === "human") return value;
  return fail(`${field} must be "agent" or "human".`);
}

function agentFor(value: unknown, field: string): string {
  const key = text(value, field).toLowerCase();
  if (!key) return AGENTS.find((agent) => agent.provider === "codex")!.id;
  const agent = AGENTS.find(
    (item) => item.id === key || item.provider === key || item.name.toLowerCase() === key || item.provider.split("-")[0] === key,
  );
  return agent?.id ?? fail(`${field} must be one of: codex, claude.`);
}

function dependencies(
  state: OrchestrationState,
  projectId: string,
  value: unknown,
  where: string,
  field: string,
): { source: string; gate: Gate }[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${field} must be a list.`);
  const tasks = state.tasks.filter((task) => task.projectId === projectId);
  const found = new Map<string, Gate>();
  for (const entry of value) {
    const spec: Record<string, unknown> =
      typeof entry === "string" ? { task: entry } : (record(entry) ?? fail(`${field} has an entry that is not a task.`));
    const key = text(spec.task, `${field}[].task`) || fail(`${field} has an entry without a task.`);
    const gate = spec.gate === undefined ? "verified" : spec.gate;
    if (typeof gate !== "string" || !(gate in GATE_LABEL)) fail(`A ${field} gate must be "completed" or "verified".`);
    const byId = tasks.find((task) => task.id === key);
    const byName = byId ? [byId] : tasks.filter((task) => task.name.toLowerCase() === key.toLowerCase());
    if (byName.length > 1) fail(`${where} depends on ${key}, but more than one task has that name. Use its id.`);
    const source = byName[0] ?? fail(`${where} depends on ${key}, which is not a task in this project.`);
    found.set(source.id, gate as Gate);
  }
  return [...found].map(([source, gate]) => ({ source, gate }));
}

function freeWorktree(state: OrchestrationState, projectId: string, name: string): string {
  const taken = new Set(state.tasks.filter((task) => task.projectId === projectId).map((task) => task.worktree));
  const base = slugify(name);
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}-${n}`;
  return candidate;
}

export interface Batch {
  id: string;
  projectId: string;
  taskIds: string[];
  actions: Action[];
}

/**
 * An open tab saves the whole board on every change, so a server write could be overwritten by it.
 * While a tab has polled this recently, new tasks wait here for the tab to apply. Background tabs
 * poll as rarely as once a minute.
 */
export const TAB_LIVE_MS = 90_000;

export function createInbox(file: string, writeBoard: (state: OrchestrationState) => void, clock = () => Date.now()) {
  let tabSeenAt = Number.NEGATIVE_INFINITY;
  let counter = 0;
  const read = (): Batch[] => {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as { batches?: unknown };
      return Array.isArray(raw.batches) ? (raw.batches as Batch[]) : [];
    } catch {
      return [];
    }
  };
  const write = (batches: Batch[]) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ batches }));
  };
  const apply = (state: OrchestrationState, batches: Batch[]) =>
    batches.flatMap((batch) => batch.actions).reduce(reducer, { ...state, now: clock() });
  const tabLive = () => clock() - tabSeenAt < TAB_LIVE_MS;

  return {
    /** The open tab asks for queued tasks. */
    poll(): Batch[] {
      tabSeenAt = clock();
      return read();
    },
    /** A tab saved the board: drop batches it has applied, or whose project is gone. */
    saved(body: unknown) {
      tabSeenAt = clock();
      const batches = read();
      if (!batches.length) return;
      const state = record(record(record(body)?.state)?.state);
      const ids = (list: unknown) => new Set(Array.isArray(list) ? list.map((item) => record(item)?.id) : []);
      const tasks = ids(state?.tasks);
      const projects = ids(state?.projects);
      const left = batches.filter((batch) => projects.has(batch.projectId) && !batch.taskIds.every((id) => tasks.has(id)));
      if (left.length !== batches.length) write(left);
    },
    /** The board including queued tasks. With no tab open, queued tasks are written to the board now. */
    flushOrPreview(state: OrchestrationState): { state: OrchestrationState; pending: Set<string> } {
      const batches = read();
      if (!batches.length) return { state, pending: new Set() };
      const next = apply(state, batches);
      if (tabLive()) return { state: next, pending: new Set(batches.flatMap((batch) => batch.taskIds)) };
      writeBoard(next);
      write([]);
      return { state: next, pending: new Set() };
    },
    add(state: OrchestrationState, body: unknown) {
      const batches = read();
      const stamp = `${clock().toString(36)}${(counter++).toString(36)}`;
      const planned = planTasks(apply(state, batches), body, (index) => `task-api-${stamp}-${index + 1}`);
      if ("error" in planned) return planned;
      const batch: Batch = {
        id: `batch-${stamp}`,
        projectId: planned.projectId,
        taskIds: planned.tasks.map((task) => task.id),
        actions: planned.actions,
      };
      const response = { project: planned.projectId, tasks: planned.tasks };
      if (tabLive()) {
        write([...batches, batch]);
        return { ...response, applied: false, note: "Shepherd is open in a browser. That tab adds these tasks within a few seconds." };
      }
      writeBoard(apply(state, [...batches, batch]));
      write([]);
      return { ...response, applied: true, note: "Added to the board." };
    },
  };
}

/** What an outside agent needs to pick a project and name dependencies. */
export function boardSummary(state: OrchestrationState, pending: Set<string>) {
  return {
    projects: state.projects.map((project) => ({
      id: project.id,
      name: project.name,
      directory: project.directory ?? null,
      tasks: state.tasks
        .filter((task) => task.projectId === project.id)
        .map((task) => ({
          id: task.id,
          name: task.name,
          status: task.status,
          runner: task.runner,
          agent: task.runner === "human" ? null : (agentById(task.agentId)?.name ?? null),
          verified: isFullyVerified(task),
          branch: task.git?.branch ?? null,
          dependsOn: state.dependencies.filter((dep) => dep.target === task.id).map((dep) => ({ task: dep.source, gate: dep.gate })),
          ...(pending.has(task.id) ? { pending: true } : {}),
        })),
    })),
  };
}
