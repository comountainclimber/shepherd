import type { OrchestrationState, Task } from "../model/types";

export interface UpstreamContext {
  name: string;
  objective: string;
  files: string[];
  summary?: string;
}

export function upstreamTasks(state: OrchestrationState, task: Task): Task[] {
  return state.dependencies
    .filter((dep) => dep.target === task.id)
    .map((dep) => state.tasks.find((item) => item.id === dep.source))
    .filter((item): item is Task => !!item);
}

export function upstreamContext(state: OrchestrationState, task: Task): UpstreamContext[] {
  return upstreamTasks(state, task).map((item) => ({
    name: item.name,
    objective: item.objective,
    files: item.filesChanged,
    summary: item.status === "completed" ? item.activity : undefined,
  }));
}

export function taskPrompt(task: Task, extra?: string, upstream: UpstreamContext[] = []): string {
  const followUp = extra?.trim() ?? "";
  const earlier = task.instructions.filter((line) => line !== followUp);
  const inputs = upstream.map((item) =>
    [
      `- ${item.name}: ${item.objective}`,
      item.files.length ? `  Files it wrote: ${item.files.join(", ")}` : "  It did not write any files.",
      item.summary && !task.independent ? `  Its summary: ${item.summary}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const check = task.verification.find((item) => item.kind === "command");
  const failed = check && check.exitCode !== undefined && check.exitCode !== 0 ? check : null;
  const checkLines = task.checkCommand
    ? [
        "",
        `When you finish, Shepherd runs this command in the current directory: ${task.checkCommand}`,
        "The task only passes if it exits 0. Run it yourself before you finish.",
        task.checkCommand.includes("SHEPHERD_GATE")
          ? "SHEPHERD_GATE is Shepherd's gate script and is set in your environment too. Your own runs of it are practice; only Shepherd's run counts."
          : "",
        failed
          ? [
              `It failed last time (${failed.evidence}). Its output:`,
              "```",
              (failed.output ?? "").slice(-2000).trim() || "(no output)",
              "```",
              "Fix the cause, not the check.",
            ].join("\n")
          : "",
      ]
    : [];
  return [
    "You are executing one Shepherd task.",
    "Work only in the current directory. It is this task's own git worktree, so other tasks cannot see or overwrite your changes.",
    "Shepherd commits your changes when you finish. Do not commit, push, or switch branches yourself.",
    "",
    `Task: ${task.name}`,
    `Objective: ${task.objective}`,
    task.description && task.description !== task.objective ? `Context: ${task.description}` : "",
    task.acceptance.length ? ["", "Done when:", ...task.acceptance.map((line) => `- ${line}`)].join("\n") : "",
    ...checkLines,
    "",
    inputs.length ? "Upstream tasks this one builds on. Work they committed is already in this worktree:" : "",
    ...inputs,
    inputs.length && task.independent
      ? "You are an independent check on that work. Shepherd does not give you the upstream agents' own accounts of it, so judge it from the files and the criteria above."
      : "",
    earlier.length ? ["Earlier instructions:", ...earlier.map((line) => `- ${line}`)].join("\n") : "",
    followUp ? `\nNew instruction:\n${followUp}\n` : "",
    "When you finish, summarize what changed and how to verify it.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
