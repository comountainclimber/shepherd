import type { Task, WorkCheckResult } from "./types";

export function workCheckPassed(result: WorkCheckResult): boolean {
  return !result.violations.length && result.items.every((item) => item.verdict !== "not met");
}

export function workCheckText(result: WorkCheckResult): string {
  return [
    ...result.items.map((item) => `Done when ${item.item}: ${item.verdict} — ${item.reason}`),
    ...result.violations.map((text) => `Against the step's instructions: ${text}`),
    ...result.unrequested.map((text) => `Not asked for: ${text}`),
  ].join("\n");
}

/** Inputs a verdict must still describe when its Codex run finishes. */
export function workCheckInput(task: Task): string {
  return JSON.stringify([task.name, task.objective, task.description, task.acceptance, task.instructions, task.git?.head]);
}
