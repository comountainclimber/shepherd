import { blankGoal, blankTask, nextPosition, slugify } from "../src/model/factory";
import { resolveGoal } from "../src/model/goals";
import { isEffort, isModelId } from "../src/model/models";
import { reducer } from "../src/model/reducer";
import { EFFORTS, GATE_LABEL, type Action, type Effort, type Gate, type OrchestrationState, type Project, type Runner } from "../src/model/types";
import { isFullyVerified } from "../src/model/verify";
import { AGENTS, agentById, projectDirectory } from "../src/model/workspace";
import { repoPath } from "./projectRepos";

export const MAX_TASKS = 50;

export interface Planned {
  projectId: string;
  goalId: string;
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
  const goal = resolveGoal(state, raw.goal, raw.project);
  if ("error" in goal) fail(goal.error);
  if (goal.status !== "open") fail("Reopen this task before adding steps.");
  const project = state.projects.find((project) => project.id === goal.projectId)!;
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
    const checkCommand = text(request.checkCommand, field("checkCommand"));
    const review = flag(request.review, field("review"), false);
    const autoRun = flag(request.autoRun, field("autoRun"), false);
    const independent = flag(request.independent, field("independent"), false);
    const model = text(request.model, field("model"));
    if (model && !isModelId(model)) fail(`${field("model")} is not a model name, such as gpt-6-astra or opus.`);
    const effort = text(request.thinking, field("thinking"));
    if (effort && !isEffort(effort)) fail(`${field("thinking")} must be one of: ${EFFORTS.join(", ")}.`);
    if (runner === "human" && (autoRun || independent || review || model || effort)) {
      fail(`${where} is done by a person, so autoRun, independent, review, model and thinking do not apply to it.`);
    }
    const dependsOn = dependencies(scratch, goal.id, request.dependsOn, where, field("dependsOn"));
    const id = newId(index);
    const task = {
      ...blankTask({
        id,
        projectId: project.id,
        goalId: goal.id,
        name,
        objective: text(request.objective, field("objective")) || name,
        description: text(request.description, field("description")),
        acceptance: lines(request.acceptance, field("acceptance")),
        checkCommand,
        review,
        autoRun,
        independent,
        runner,
        agentId: runner === "human" ? null : agentFor(request.agent, field("agent")),
        worktree: freeWorktree(scratch, project.id, name),
        position: nextPosition(scratch.tasks, goal.id, dependsOn.map((dep) => dep.source)),
      }),
      ...(model ? { model } : {}),
      ...(effort ? { effort: effort as Effort } : {}),
    };
    const action: Action = { type: "createTask", task, dependsOn };
    scratch = reducer(scratch, action);
    actions.push(action);
    tasks.push({ id, name });
  });
  return { projectId: project.id, goalId: goal.id, tasks, actions };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") fail(`${field} must be a string.`);
  return value.trim();
}

function flag(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") fail(`${field} must be true or false.`);
  return value;
}

/** Turns an API request into the createProject action the New project dialog would dispatch. */
export function planProject(state: OrchestrationState, body: unknown, id: string): { project: Project; action: Action } | { error: string } {
  try {
    const raw = record(body) ?? fail("Send a JSON object.");
    const name = text(raw.name, "name") || fail("The project needs a name.");
    const taken = state.projects.find((project) => project.name.toLowerCase() === name.toLowerCase());
    if (taken) fail(`There is already a project named ${taken.name} (${taken.id}).`);
    if (raw.directory !== undefined) fail("Use repo for an existing repository's absolute path. Omit it for a new folder in the workspace.");
    const repo = text(raw.repo, "repo");
    if (raw.repo !== undefined && !repo) fail("repo must name an existing repository by its absolute path.");
    let absolute: string | undefined;
    if (repo) {
      try { absolute = repoPath(repo); } catch (error) { fail((error as Error).message); }
    }
    const project: Project = { id, name, summary: text(raw.summary, "summary"), ...(absolute ? { repo: absolute } : { directory: projectDirectory(name, state.projects) }) };
    return { project, action: { type: "createProject", project } };
  } catch (error) {
    if (error instanceof Invalid) return { error: error.message };
    throw error;
  }
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
  goalId: string,
  value: unknown,
  where: string,
  field: string,
): { source: string; gate: Gate }[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(`${field} must be a list.`);
  const tasks = state.tasks.filter((task) => task.goalId === goalId);
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
    const source = byName[0] ?? fail(`${where} depends on ${key}, which is not a step in this task.`);
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

/** What an outside agent needs to pick a project and name dependencies. */
export function boardSummary(state: OrchestrationState) {
  return {
    projects: state.projects.map((project) => ({
      id: project.id,
      name: project.name,
      directory: project.directory ?? null,
      repo: project.repo ?? null,
      goals: state.goals.filter((goal) => goal.projectId === project.id),
      tasks: state.tasks
        .filter((task) => task.projectId === project.id)
        .map((task) => ({
          id: task.id,
          name: task.name,
          goalId: task.goalId,
          status: task.status,
          runner: task.runner,
          agent: task.runner === "human" ? null : (agentById(task.agentId)?.name ?? null),
          verified: isFullyVerified(task),
          branch: task.git?.branch ?? null,
          dependsOn: state.dependencies.filter((dep) => dep.target === task.id).map((dep) => ({ task: dep.source, gate: dep.gate })),
        })),
    })),
  };
}

export function planGoal(state: OrchestrationState, body: unknown, id: string) {
  try {
    const raw = record(body) ?? fail("Send a JSON object.");
    const project = findProject(state, raw.project);
    const name = text(raw.name, "name") || fail("The task needs a name.");
    const goal = blankGoal(project.id, name, id, text(raw.goal, "goal"));
    return { goal, action: { type: "createGoal", goal } as Action };
  } catch (error) {
    if (error instanceof Invalid) return { error: error.message };
    throw error;
  }
}
