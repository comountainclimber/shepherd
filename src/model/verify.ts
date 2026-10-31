import type { Dependency, Task } from "./types";

/** Finished, and every check it has passed. A step with no checks is done when its agent finishes. */
export function isFullyVerified(task: Task): boolean {
  if (task.outdated || task.status !== "completed") return false;
  return task.verification.every((check) => check.state === "passed");
}

/** What a finished but unverified task is waiting for. */
export function awaiting(task: Task): string {
  return task.verification.some((check) => check.kind === "review" && check.state === "pending") ? "Needs your review" : "Checking";
}

export function dependencySatisfied(dep: Dependency, source: Task | undefined): boolean {
  if (!source || source.status !== "completed") return false;
  return dep.gate === "verified" ? isFullyVerified(source) : true;
}

export function unmetReason(dep: Dependency, source: Task | undefined): string {
  const name = source?.name || "A removed step";
  if (!source || source.status !== "completed") return `${name} has not finished`;
  return `${name} is not done`;
}

export function unmetDependencies(taskId: string, tasks: Task[], deps: Dependency[]): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const reasons: string[] = [];
  for (const dep of deps) {
    if (dep.target !== taskId) continue;
    const source = byId.get(dep.source);
    if (!dependencySatisfied(dep, source)) reasons.push(unmetReason(dep, source));
  }
  return reasons;
}
