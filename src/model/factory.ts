import type { Runner, Task, VerificationCheck, VerificationKind, VerificationState } from "./types";

export function slugify(text: string, fallback = "task"): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function check(taskId: string, kind: VerificationKind, state: VerificationState, evidence: string): VerificationCheck {
  return { id: `${taskId}-${kind}`, kind, state, evidence, timestamp: null };
}

export function commandCheck(taskId: string, command: string): VerificationCheck {
  return {
    ...check(taskId, "command", "pending", "Not run yet. Shepherd runs it when the work is done."),
    command,
  };
}

export function blankTask(args: {
  id: string;
  projectId: string;
  name: string;
  objective: string;
  agentId: string | null;
  position: { x: number; y: number };
  worktree?: string;
  description?: string;
  runner?: Runner;
  acceptance?: string[];
  checkCommand?: string;
  /** False lets an agent task with a check command be verified by the check alone. */
  review?: boolean;
  autoRun?: boolean;
  independent?: boolean;
}): Task {
  const runner = args.runner ?? "agent";
  const command = args.checkCommand?.trim() ?? "";
  const agent = runner === "agent";
  const review = agent && (args.review !== false || !command) ? [reviewCheck(args.id)] : [];
  return {
    id: args.id,
    projectId: args.projectId,
    name: args.name,
    objective: args.objective,
    description: args.description ?? "",
    acceptance: args.acceptance ?? [],
    status: "queued",
    runner,
    agentId: runner === "human" ? null : args.agentId,
    worktree: args.worktree ?? args.id,
    startedAt: null,
    elapsedMs: 0,
    activity: runner === "human" ? "Waiting for you" : "Queued",
    blocker: null,
    position: args.position,
    verification: command ? [commandCheck(args.id, command), ...review] : review,
    filesChanged: [],
    previews: [],
    instructions: [],
    ...(command ? { checkCommand: command } : {}),
    ...(agent && args.autoRun ? { autoRun: true } : {}),
    ...(agent && args.independent ? { independent: true } : {}),
  };
}

export function reviewCheck(taskId: string): VerificationCheck {
  return check(taskId, "review", "pending", "Review the files this task wrote, then accept or reject.");
}

export function nextPosition(
  tasks: Task[],
  projectId: string,
  dependsOn: string[],
): { x: number; y: number } {
  const mine = tasks.filter((task) => task.projectId === projectId);
  const anchors = mine.filter((task) => dependsOn.includes(task.id));
  const baseX = anchors.length
    ? Math.max(...anchors.map((task) => task.position.x))
    : mine.length
      ? Math.max(...mine.map((task) => task.position.x))
      : 0;
  const x = mine.length ? baseX + 300 : 24;
  const siblings = mine.filter((task) => Math.abs(task.position.x - x) < 80);
  const y = siblings.length ? Math.max(...siblings.map((task) => task.position.y)) + 156 : 24;
  return { x, y };
}
