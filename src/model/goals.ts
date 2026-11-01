import { needsYou, progress } from "./stage";
import type { Goal, OrchestrationState } from "./types";

/** Project-only callers must never silently pick one of several open tasks. */
export function resolveGoal(state: OrchestrationState, goalKey?: unknown, projectKey?: unknown): Goal | { error: string } {
  let projectId: string | undefined;
  if (projectKey !== undefined && projectKey !== null && projectKey !== "") {
    if (typeof projectKey !== "string") return { error: "project must be an id or name." };
    const projects = state.projects.filter((project) => project.id === projectKey || project.name.toLowerCase() === projectKey.toLowerCase());
    const exact = projects.find((project) => project.id === projectKey);
    if (!exact && projects.length !== 1) return { error: projects.length ? `More than one project is named ${projectKey}. Use its id.` : `There is no project ${projectKey}.` };
    projectId = (exact ?? projects[0])!.id;
  }
  const goals = state.goals.filter((goal) => !projectId || goal.projectId === projectId);
  if (goalKey !== undefined && goalKey !== null && goalKey !== "") {
    if (typeof goalKey !== "string") return { error: "goal must be a task id or name." };
    const exact = goals.find((goal) => goal.id === goalKey);
    const matches = exact ? [exact] : goals.filter((goal) => goal.name.toLowerCase() === goalKey.toLowerCase());
    if (matches.length !== 1) return { error: matches.length ? `More than one task is named ${goalKey}. Use its goal id.` : `There is no task ${goalKey}.` };
    return matches[0]!;
  }
  if (!projectId) return { error: "Say which task, as goal, or which project." };
  const open = goals.filter((goal) => goal.status === "open");
  if (open.length !== 1) return { error: open.length ? `This project has several open tasks. Pick a goal by id or name: ${open.map((goal) => `${goal.name} (${goal.id})`).join(", ")}.` : "This project has no open tasks. Add or reopen a task first." };
  return open[0]!;
}

/** Task summaries use accepted steps, including checks, just like the outline. */
export function goalSummary(state: OrchestrationState, goal: Goal) {
  const steps = state.tasks.filter((step) => step.goalId === goal.id);
  return {
    ...progress(steps),
    running: goal.running || steps.some((step) => step.status === "running" || step.verification.some((check) => check.running)),
    needsYou: !!goal.blocker || steps.some((step) => needsYou(step, state.tasks, state.dependencies)),
  };
}
