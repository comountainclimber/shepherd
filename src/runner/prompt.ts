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

/** How much of each earlier step's report goes into a prompt. */
const REPORT_LIMIT = 4000;

export function upstreamContext(state: OrchestrationState, task: Task): UpstreamContext[] {
  return upstreamTasks(state, task).map((item) => {
    const report = item.status === "completed" ? (item.output ?? item.activity) : "";
    return {
      name: item.name,
      objective: item.objective || item.name,
      files: item.filesChanged,
      summary: report ? (report.length > REPORT_LIMIT ? `${report.slice(0, REPORT_LIMIT)}…` : report) : undefined,
    };
  });
}

export function taskPrompt(task: Task, extra?: string, upstream: UpstreamContext[] = []): string {
  const followUp = extra?.trim() ?? "";
  const earlier = task.instructions.filter((line) => line !== followUp);
  const inputs = upstream.map((item) =>
    [
      `- ${item.name}: ${item.objective}`,
      item.files.length ? `  Files it wrote: ${item.files.join(", ")}` : "  It did not write any files.",
      item.summary && !task.independent ? `  What it reported:\n${indent(item.summary)}` : "",
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
    "You are doing one step of a plan that Shepherd runs with several agents.",
    "Work only in the current directory. It is this step's own git worktree, so other steps cannot see or overwrite your changes.",
    "Shepherd commits your changes when you finish. Do not commit, push, or switch branches yourself.",
    "",
    `Task: ${task.name}`,
    `Objective: ${task.objective || task.name}`,
    task.description && task.description !== task.objective ? `Context: ${task.description}` : "",
    task.acceptance.length ? ["", "Done when:", ...task.acceptance.map((line) => `- ${line}`)].join("\n") : "",
    ...checkLines,
    "",
    inputs.length ? "Earlier steps this one builds on. Their work is already merged into this worktree:" : "",
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

function indent(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
