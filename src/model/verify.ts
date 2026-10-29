import type { Dependency, Task } from "./types";

export function isFullyVerified(task: Task): boolean {
  const checks = task.verification;
  if (task.runner === "human") {
    return task.status === "completed" && checks.every((check) => check.state === "passed");
  }
  return checks.length > 0 && checks.every((check) => check.state === "passed");
}

export function dependencySatisfied(dep: Dependency, source: Task | undefined): boolean {
  if (!source || source.status !== "completed") return false;
  return dep.gate === "verified" ? isFullyVerified(source) : true;
}

export function unmetReason(dep: Dependency, source: Task | undefined): string {
  const name = source?.name ?? "A removed task";
  if (!source || source.status !== "completed") return `${name} has not finished`;
  return `${name} is not verified`;
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
