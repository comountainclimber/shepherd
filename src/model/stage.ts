import type { Dependency, Task, VerificationCheck } from "./types";
import { dependencySatisfied, isFullyVerified } from "./verify";
import { agentById } from "./workspace";

/** Where a task stands, in the words the board shows. */
export type Stage = "waiting" | "ready" | "running" | "checking" | "updating" | "needs-you" | "verified" | "failed" | "paused";

export const STAGE_LABEL: Record<Stage, string> = {
  waiting: "Waiting",
  ready: "Ready",
  running: "Running",
  checking: "Checking",
  updating: "Updating",
  "needs-you": "Needs you",
  verified: "Done",
  failed: "Failed",
  paused: "Paused",
};

export function reviewPending(task: Task): VerificationCheck | undefined {
  return task.verification.find((check) => check.kind === "review" && check.state === "pending");
}

export function failedCheck(task: Task): VerificationCheck | undefined {
  return task.verification.find((check) => check.kind === "command" && check.state === "failed");
}

/** The upstream tasks whose gates into this one are still closed. */
export function waitingFor(task: Task, tasks: Task[], deps: Dependency[]): Task[] {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  return deps
    .filter((dep) => dep.target === task.id && !dependencySatisfied(dep, byId.get(dep.source)))
    .flatMap((dep) => {
      const source = byId.get(dep.source);
      return source ? [source] : [];
    });
}

export function stageOf(task: Task, tasks: Task[], deps: Dependency[]): Stage {
  if (isFullyVerified(task)) return "verified";
  if (task.status === "running") return "running";
  if (task.verification.some((check) => check.running)) return "checking";
  if (task.status === "failed") return "failed";
  const blocked = waitingFor(task, tasks, deps).length > 0;
  if (task.status === "completed") return reviewPending(task) ? "needs-you" : "checking";
  if (task.outdated) return blocked ? "waiting" : "updating";
  if (task.status === "blocked") return blocked && task.blocker !== "Paused by you" ? "waiting" : "paused";
  if (blocked) return "waiting";
  return task.runner === "human" ? "needs-you" : "ready";
}

/** One short line under the task's name. */
export function stageHint(task: Task, stage: Stage, tasks: Task[], deps: Dependency[]): string {
  switch (stage) {
    case "waiting": {
      const names = waitingFor(task, tasks, deps).map((item) => item.name);
      return names.length ? `Waiting on ${names[0]}${names.length > 1 ? ` and ${names.length - 1} more` : ""}` : "Waiting";
    }
    case "ready":
      if (!task.agentId) return "Pick who does it";
      return task.autoRun && !task.git ? "Starts automatically" : "Ready to start";
    case "running":
      return task.activity || "Running…";
    case "checking":
      return task.verification.some((check) => check.running) ? "Running its check" : "Waiting for its check";
    case "updating":
      return "Merging in upstream changes";
    case "needs-you":
      return reviewPending(task) && task.status === "completed" ? "Ready for your review" : "Your task";
    case "verified":
      if (task.git?.merged) return `Merged into ${task.git.merged.into}`;
      if (task.runner === "human") return "Marked done by you";
      return task.verification.length ? "Checks passed" : firstLine(task.output) || "Finished";
    case "failed":
      return failedCheck(task) ? "Its check failed" : (task.blocker ?? "The run failed");
    case "paused":
      return "Paused";
  }
}

export type AssigneeKind = "codex" | "claude" | "person" | "none";

export interface Assignee {
  kind: AssigneeKind;
  name: string;
}

export function assigneeFor(task: Task): Assignee {
  if (task.runner === "human") return { kind: "person", name: "You" };
  const agent = agentById(task.agentId);
  if (!agent) return { kind: "none", name: "Unassigned" };
  return { kind: agent.provider === "codex" ? "codex" : "claude", name: agent.name };
}

/** The first line of an agent's report, without Markdown decoration. */
export function firstLine(text: string | undefined): string {
  const line = (text ?? "").split("\n").find((item) => item.trim()) ?? "";
  return line.replace(/^[#>*\-\s]+/, "").replace(/\*\*|__|`/g, "").trim();
}

export interface Progress {
  done: number;
  total: number;
  percent: number;
  complete: boolean;
}

export function progress(tasks: Task[]): Progress {
  const done = tasks.filter(isFullyVerified).length;
  const total = tasks.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0, complete: total > 0 && done === total };
}

/** Nothing happens to this step until you act: review it, retry it, resume it, do it, or pick who does it. */
export function needsYou(task: Task, tasks: Task[], deps: Dependency[]): boolean {
  const stage = stageOf(task, tasks, deps);
  if (stage === "ready") return task.runner === "agent" && !task.agentId;
  return stage === "needs-you" || stage === "failed" || stage === "paused";
}

/** What the person at the board does next for a task, if anything. */
export type NextStep = "start" | "resume" | "retry" | "review" | "done" | "merge" | null;

export function nextStep(task: Task, stage: Stage): NextStep {
  if (stage === "ready") return task.agentId ? "start" : null;
  if (stage === "paused") return task.runner === "human" ? "done" : "resume";
  if (stage === "failed") return task.runner === "human" ? "done" : "retry";
  if (stage === "needs-you") return task.status === "completed" ? "review" : "done";
  if (stage === "verified" && task.git && !task.git.merged) return "merge";
  return null;
}

export const STEP_LABEL: Record<Exclude<NextStep, null>, string> = {
  start: "Start",
  resume: "Resume",
  retry: "Retry",
  review: "Review",
  done: "Mark done",
  merge: "Merge",
};
