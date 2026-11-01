import { needsYou } from "./stage";
import type { Dependency, Filters, OrchestrationState, Task } from "./types";
import { isFullyVerified, unmetDependencies } from "./verify";

export function tasksForGoal(state: OrchestrationState, goalId: string): Task[] {
  return state.tasks.filter((task) => task.goalId === goalId);
}

export function taskMatches(task: Task, filters: Filters, tasks: Task[], deps: Dependency[]): boolean {
  if (filters.status !== "all" && task.status !== filters.status) return false;
  if (filters.agentId !== "all" && task.agentId !== filters.agentId) return false;
  if (filters.verification === "verified" && !isFullyVerified(task)) return false;
  if (filters.verification === "unverified" && !(task.status === "completed" && !isFullyVerified(task))) {
    return false;
  }
  if (filters.verification === "failed" && task.status !== "failed" && !task.verification.some((check) => check.state === "failed")) {
    return false;
  }
  if (filters.savedView === "needs-me" && !needsYou(task, tasks, deps)) return false;
  if (filters.savedView === "running" && task.status !== "running") return false;
  if (filters.savedView === "unverified" && !(task.status === "completed" && !isFullyVerified(task))) return false;
  if (filters.search.trim()) {
    const blob = `${task.name} ${task.objective} ${task.worktree} ${task.activity}`.toLowerCase();
    if (!blob.includes(filters.search.trim().toLowerCase())) return false;
  }
  return true;
}

export function connectedIds(taskId: string, deps: Dependency[]): Set<string> {
  const ids = new Set<string>([taskId]);
  const up = [taskId];
  while (up.length) {
    const id = up.pop()!;
    for (const dep of deps) {
      if (dep.target === id && !ids.has(dep.source)) {
        ids.add(dep.source);
        up.push(dep.source);
      }
    }
  }
  const downSeen = new Set<string>([taskId]);
  const down = [taskId];
  while (down.length) {
    const id = down.pop()!;
    for (const dep of deps) {
      if (dep.source === id && !downSeen.has(dep.target)) {
        downSeen.add(dep.target);
        ids.add(dep.target);
        down.push(dep.target);
      }
    }
  }
  return ids;
}

export function isTaskDimmed(
  task: Task,
  filters: Filters,
  tasks: Task[],
  deps: Dependency[],
  selectedId: string | null,
): boolean {
  if (!taskMatches(task, filters, tasks, deps)) return true;
  if (!selectedId) return false;
  return !connectedIds(selectedId, deps).has(task.id);
}

export function waitingOn(task: Task, tasks: Task[], deps: Dependency[]): string | null {
  if (task.status === "running" || task.status === "completed" || task.status === "failed") return null;
  const reasons = unmetDependencies(task.id, tasks, deps);
  return reasons.length ? reasons.join(". ") : null;
}

export function needsMe(task: Task, tasks: Task[], deps: Dependency[]): boolean {
  if (task.status === "failed") return true;
  if (task.status === "blocked") return task.blocker === "Paused by you" || !waitingOn(task, tasks, deps);
  if (task.status === "completed") return !isFullyVerified(task);
  return task.status === "queued" && task.runner === "human" && !waitingOn(task, tasks, deps);
}

export function incoming(taskId: string, deps: Dependency[]): Dependency[] {
  return deps.filter((dep) => dep.target === taskId);
}

export function outgoing(taskId: string, deps: Dependency[]): Dependency[] {
  return deps.filter((dep) => dep.source === taskId);
}

export function hasCycle(edges: { source: string; target: string }[]): boolean {
  const nodes = new Set<string>();
  for (const edge of edges) {
    nodes.add(edge.source);
    nodes.add(edge.target);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const edge of edges) {
      if (edge.source === id && walk(edge.target)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of nodes) {
    if (walk(id)) return true;
  }
  return false;
}
