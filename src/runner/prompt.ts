import type { Task } from "../model/types";

export interface UpstreamContext {
  name: string;
  objective: string;
  files: string[];
  summary?: string;
}

export function taskPrompt(task: Task, extra?: string, upstream: UpstreamContext[] = []): string {
  const followUp = extra?.trim() ?? "";
  const earlier = task.instructions.filter((line) => line !== followUp);
  const inputs = upstream.map((item) =>
    [
      `- ${item.name}: ${item.objective}`,
      item.files.length ? `  Files it wrote: ${item.files.join(", ")}` : "  It did not write any files.",
      item.summary ? `  Its summary: ${item.summary}` : "",
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
    "Work only in the current directory. Do not assume other repositories are checked out.",
    task.worktree
      ? `Write this task's files under ${task.worktree}/ (create it if needed). You may read anything in the current directory.`
      : "",
    "",
    `Task: ${task.name}`,
    `Objective: ${task.objective}`,
    task.description && task.description !== task.objective ? `Context: ${task.description}` : "",
    task.acceptance.length ? ["", "Done when:", ...task.acceptance.map((line) => `- ${line}`)].join("\n") : "",
    ...checkLines,
    "",
    inputs.length ? "Upstream tasks this one depends on. Read their files when you need them:" : "",
    ...inputs,
    earlier.length ? ["Earlier instructions:", ...earlier.map((line) => `- ${line}`)].join("\n") : "",
    followUp ? `\nNew instruction:\n${followUp}\n` : "",
    "When you finish, summarize what changed and how to verify it.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
