import type { Goal, Objective, OrchestrationState } from "./types";

/**
 * A repo holds objectives; an objective holds graphs; a graph is a Goal, with its own steps and branch.
 * Graphs never share steps or arrows, and each carries one of these colours.
 */
export const GRAPH_COLORS = ["#c084fc", "#4fb3f6", "#4cc77f", "#f2b544", "#f26d7d", "#2dd4bf"] as const;

export const FALLBACK_COLOR = "#6c7383";

export function isGraphColor(value: unknown): value is string {
  return typeof value === "string" && (GRAPH_COLORS as readonly string[]).includes(value);
}

export function nextColor(color: string | undefined): string {
  const index = GRAPH_COLORS.indexOf(color as (typeof GRAPH_COLORS)[number]);
  return GRAPH_COLORS[(index + 1) % GRAPH_COLORS.length]!;
}

/** `color` mixed with transparency, for row and node tints. */
export function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

export function objectiveIdFor(goalId: string): string {
  return `objective-${goalId}`;
}

/** The objectives in a repo that are not archived, in the order they were made. */
export function objectivesOf(state: OrchestrationState, projectId: string): Objective[] {
  return state.objectives.filter((objective) => objective.projectId === projectId && !objective.archived);
}

/** An objective's graphs in their order. Done graphs stay; archived ones move to its Archived list. */
export function graphsOf(state: OrchestrationState, objectiveId: string): Goal[] {
  return state.goals.filter((goal) => goal.objectiveId === objectiveId && goal.status !== "archived");
}

export function archivedGraphsOf(state: OrchestrationState, objectiveId: string): Goal[] {
  return state.goals.filter((goal) => goal.objectiveId === objectiveId && goal.status === "archived");
}

export function graphColor(goal: Goal | undefined): string {
  return goal?.color ?? FALLBACK_COLOR;
}

/** The colour a new graph in this objective gets: the palette, round-robin. */
export function colorForNewGraph(state: OrchestrationState, objectiveId: string): string {
  const count = state.goals.filter((goal) => goal.objectiveId === objectiveId).length;
  return GRAPH_COLORS[count % GRAPH_COLORS.length]!;
}

/**
 * Every goal belongs to an objective. A goal from before objectives, or made without one, gets an
 * objective of its own with its name, and every graph gets a colour.
 */
export function withObjectives(state: OrchestrationState): OrchestrationState {
  const known = new Map(state.objectives.map((objective) => [objective.id, objective]));
  const added: Objective[] = [];
  let changed = false;
  const used = new Map<string, number>();
  const goals = state.goals.map((goal) => {
    const objective = goal.objectiveId ? known.get(goal.objectiveId) : undefined;
    let objectiveId = objective?.id ?? objectiveIdFor(goal.id);
    if (!objective || objective.projectId !== goal.projectId) {
      objectiveId = objectiveIdFor(goal.id);
      if (!known.has(objectiveId)) {
        const made: Objective = { id: objectiveId, projectId: goal.projectId, name: goal.name, ...(goal.status === "archived" ? { archived: true } : {}) };
        known.set(objectiveId, made);
        added.push(made);
      }
    }
    const index = used.get(objectiveId) ?? 0;
    used.set(objectiveId, index + 1);
    const color = isGraphColor(goal.color) ? goal.color : GRAPH_COLORS[index % GRAPH_COLORS.length]!;
    if (objectiveId === goal.objectiveId && color === goal.color) return goal;
    changed = true;
    return { ...goal, objectiveId, color };
  });
  if (!changed && !added.length) return state;
  return { ...state, goals, objectives: [...state.objectives, ...added] };
}
