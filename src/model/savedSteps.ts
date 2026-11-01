import { blankTask } from "./factory";
import { CLAUDE_MODELS, isEffort, isModelId, providerOf, type ModelCatalog } from "./models";
import { MAX_DEPTH, outlineOf, subtreeEnd } from "./outline";
import type { OrchestrationState, SavedStep, SavedStepItem, Task } from "./types";
import { AGENTS } from "./workspace";

export const MAX_SAVED = 200;
const MAX_ITEMS = 20;

export const STARTERS: SavedStep[] = [
  {
    id: "starter-chrome",
    name: "Check it in Chrome",
    version: 1,
    updatedAt: 0,
    starter: true,
    steps: [
      {
        name: "Check it in Chrome",
        runner: "agent",
        agentId: "agent-codex",
        objective:
          "Do not change any files. Start this project's page if it is not running, the way its README, package.json or Background says. Then look at it the way a person would, in your own browser tool in the user's Chrome: at a wide window and at 390 pixels wide, after the clicks that matter, and after a reload. Report what is broken or looks wrong, with the steps to see it, and what you checked that works.",
        description: "",
        acceptance: [],
        depth: 0,
      },
    ],
  },
  {
    id: "starter-audit",
    name: "Audit the code",
    version: 1,
    updatedAt: 0,
    starter: true,
    steps: [
      {
        name: "Audit the code",
        runner: "agent",
        agentId: "agent-codex",
        effort: "high",
        objective:
          "Do not change any files. Read the work of the steps before this one and look for bugs: wrong behavior, edge cases it misses, errors it swallows, and anything its tests do not cover. Run its tests. Report each problem with the file and line, how to see it, and how serious it is, most serious first. Say plainly if you found nothing.",
        description: "",
        acceptance: [],
        independent: true,
        depth: 0,
      },
    ],
  },
  {
    id: "starter-yourself",
    name: "Check it yourself",
    version: 1,
    updatedAt: 0,
    starter: true,
    steps: [{ name: "Check it yourself", runner: "human", agentId: null, objective: "", description: "", acceptance: [], depth: 0 }],
  },
];

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function item(raw: unknown): SavedStepItem | null {
  const step = record(raw);
  const name = text(step?.name, 200).trim();
  if (!step || !name) return null;
  const runner = step.runner === "human" ? "human" : "agent";
  const agentId = runner === "human" ? null : AGENTS.some((agent) => agent.id === step.agentId) ? (step.agentId as string) : "agent-codex";
  const agent = runner === "agent";
  const acceptance = Array.isArray(step.acceptance) ? step.acceptance.filter((line): line is string => typeof line === "string" && !!line.trim()) : [];
  const checkCommand = text(step.checkCommand, 2000).trim();
  return {
    name,
    runner,
    agentId,
    ...(agent && isModelId(step.model) ? { model: step.model } : {}),
    ...(agent && isEffort(step.effort) ? { effort: step.effort } : {}),
    objective: text(step.objective, 20_000),
    description: text(step.description, 20_000),
    acceptance,
    ...(checkCommand ? { checkCommand } : {}),
    ...(agent && step.review === true ? { review: true } : {}),
    ...(agent && step.independent === true ? { independent: true } : {}),
    depth: Number.isInteger(step.depth) ? Math.max(0, Math.min(step.depth as number, MAX_DEPTH)) : 0,
  };
}

/** The saved steps in a file or a request, without anything Shepherd could not add to a project. */
export function readSavedSteps(raw: unknown): SavedStep[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const list: SavedStep[] = [];
  for (const entry of raw.slice(0, MAX_SAVED)) {
    const saved = record(entry);
    const id = typeof saved?.id === "string" && /^[\w-]{1,80}$/.test(saved.id) ? saved.id : null;
    const steps = Array.isArray(saved?.steps) ? saved.steps.slice(0, MAX_ITEMS).map(item).filter((step) => step !== null) : [];
    const name = text(saved?.name, 200).trim() || steps[0]?.name;
    if (!saved || !id || seen.has(id) || !steps.length || !name) continue;
    seen.add(id);
    list.push({
      id,
      name,
      version: Number.isInteger(saved.version) && (saved.version as number) > 0 ? (saved.version as number) : 1,
      updatedAt: typeof saved.updatedAt === "number" && Number.isFinite(saved.updatedAt) ? saved.updatedAt : 0,
      ...(saved.starter === true ? { starter: true } : {}),
      steps,
    });
  }
  return list;
}

/** What a saved step keeps of a step. A person's checklist is left out unless asked, so each project gets a fresh one. */
export function toSavedItem(task: Task, depth: number, keepChecklist = true): SavedStepItem {
  const agent = task.runner === "agent";
  const checkCommand = task.checkCommand?.trim();
  return {
    name: task.name.trim() || "Untitled step",
    runner: task.runner,
    agentId: agent ? task.agentId : null,
    ...(agent && task.model ? { model: task.model } : {}),
    ...(agent && task.effort ? { effort: task.effort } : {}),
    objective: agent || keepChecklist ? task.objective : "",
    description: task.description,
    acceptance: task.acceptance.filter((line) => line.trim()),
    ...(checkCommand ? { checkCommand } : {}),
    ...(agent && task.verification.some((check) => check.kind === "review") ? { review: true } : {}),
    ...(agent && task.independent ? { independent: true } : {}),
    depth,
  };
}

/** The steps you can save along with one: those side by side with it, and those under it. */
export function relatives(state: OrchestrationState, taskId: string): { siblings: string[]; children: string[] } {
  const items = outlineOf(state, state.tasks.find((task) => task.id === taskId)?.goalId ?? "");
  const index = items.findIndex((entry) => entry.id === taskId);
  if (index < 0) return { siblings: [], children: [] };
  const depth = items[index]!.depth;
  const children = items.slice(index + 1, subtreeEnd(items, index)).map((entry) => entry.id);
  if (depth === 0) return { siblings: [], children };
  let start = index;
  while (start > 0 && items[start - 1]!.depth >= depth) start -= 1;
  let end = index;
  while (end + 1 < items.length && items[end + 1]!.depth >= depth) end += 1;
  const siblings = items
    .slice(start, end + 1)
    .filter((entry) => entry.depth === depth && entry.id !== taskId)
    .map((entry) => entry.id);
  return { siblings, children };
}

/**
 * Steps from one project, in outline order, as a block to save. Steps that ran side by side under
 * another step keep their indent, so they run side by side wherever they are added.
 */
export function blockOf(state: OrchestrationState, ids: string[], checklistFor: (task: Task) => boolean = () => true): SavedStepItem[] {
  const first = state.tasks.find((task) => task.id === ids[0]);
  if (!first) return [];
  const wanted = new Set(ids);
  const items = outlineOf(state, first.goalId).filter((entry) => wanted.has(entry.id));
  if (!items.length) return [];
  const base = Math.min(...items.map((entry) => entry.depth));
  const sideBySide = base > 0 && items.filter((entry) => entry.depth === base).length > 1;
  return items.map((entry) => {
    const task = state.tasks.find((candidate) => candidate.id === entry.id)!;
    return toSavedItem(task, entry.depth - base + (sideBySide ? 1 : 0), checklistFor(task));
  });
}

/** Where a saved step goes when added after a row: past that row's own sub-steps, at its indent. */
export function placeAfter(state: OrchestrationState, goalId: string, taskId: string | null): { after: string | null; depth: number } {
  const items = outlineOf(state, goalId);
  const index = taskId ? items.findIndex((entry) => entry.id === taskId) : -1;
  if (index < 0) return { after: items.at(-1)?.id ?? null, depth: 0 };
  return { after: items[subtreeEnd(items, index) - 1]!.id, depth: items[index]!.depth };
}

/** Whether a model a saved step names is one its agent offers here. Unknown lists accept anything. */
function offered(model: string, provider: "codex" | "claude", catalog: ModelCatalog | null): boolean {
  const models = provider === "codex" ? catalog?.codex.models : CLAUDE_MODELS;
  return !models?.length || models.some((choice) => choice.id === model);
}

/** Fresh copies of a saved step's steps for a project. Models this machine does not offer fall back to the default. */
export function fromSaved(
  saved: SavedStep,
  projectId: string,
  depth: number,
  catalog: ModelCatalog | null,
  newId: (index: number) => string,
): { steps: { task: Task; depth: number }[]; unavailable: string[] } {
  const unavailable: string[] = [];
  const steps = saved.steps.map((entry, index) => {
    const id = newId(index);
    const task = blankTask({
      id,
      projectId,
      name: entry.name,
      objective: entry.objective,
      description: entry.description,
      acceptance: entry.acceptance,
      checkCommand: entry.checkCommand,
      review: entry.review,
      independent: entry.independent,
      runner: entry.runner,
      agentId: entry.agentId,
      worktree: id,
      position: { x: 0, y: 0 },
    });
    const provider = providerOf(task);
    const keep = !!entry.model && !!provider && offered(entry.model, provider, catalog);
    if (entry.model && !keep) unavailable.push(entry.model);
    return {
      task: {
        ...task,
        ...(keep ? { model: entry.model } : {}),
        ...(provider && entry.effort ? { effort: entry.effort } : {}),
        savedFrom: { id: saved.id, version: saved.version },
      },
      depth: Math.min(depth + entry.depth, MAX_DEPTH),
    };
  });
  return { steps, unavailable };
}

/** Whether a copy of a one-step saved step has been changed since, in anything the saved step keeps. */
export function changedFrom(task: Task, saved: SavedStep): boolean {
  if (saved.steps.length !== 1) return false;
  const { depth: _was, ...was } = saved.steps[0]!;
  const { depth: _depth, ...now } = toSavedItem(task, 0, was.runner !== "human" || !!was.objective);
  return JSON.stringify(sorted(now)) !== JSON.stringify(sorted(was));
}

function sorted(value: object): [string, unknown][] {
  return Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
}

/** Adds a saved step, or replaces the one with its id and counts a new version. */
export function upsertSaved(list: SavedStep[], entry: Omit<SavedStep, "version" | "updatedAt">, now: number): SavedStep[] {
  const existing = list.find((saved) => saved.id === entry.id);
  const { starter: _starter, ...rest } = entry;
  const next: SavedStep = { ...rest, version: (existing?.version ?? 0) + 1, updatedAt: now };
  return existing ? list.map((saved) => (saved.id === entry.id ? next : saved)) : [...list, next];
}

/** Adds back any starter you deleted, without touching the rest. */
export function withStarters(list: SavedStep[]): SavedStep[] {
  const ids = new Set(list.map((saved) => saved.id));
  return [...list, ...STARTERS.filter((starter) => !ids.has(starter.id))];
}

export function savedId(): string {
  return `saved-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
