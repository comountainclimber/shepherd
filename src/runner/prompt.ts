import { openIssues } from "../model/stage";
import { dependencyOrder } from "../model/outline";
import type { OrchestrationState, Task } from "../model/types";

export interface UpstreamContext {
  name: string;
  objective: string;
  files: string[];
  summary?: string;
  /** Problems someone noted in its work and left for later. */
  issues?: string[];
}

export interface PromptOptions {
  /** The agent can ask Shepherd for screenshots with $SHEPHERD_LOOK. */
  look?: boolean;
  taskBranch?: string;
  pushed?: { remote: string; branch: string; base: string };
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
  let steps = upstreamTasks(state, task);
  if (task.pushBeforeRun) {
    const seen = new Set<string>([task.id]);
    const visit = (step: Task) => {
      if (seen.has(step.id) || step.goalId !== task.goalId) return;
      seen.add(step.id);
      for (const earlier of upstreamTasks(state, step)) visit(earlier);
    };
    for (const step of steps) visit(step);
    steps = dependencyOrder(state.tasks.filter((step) => step.id !== task.id && seen.has(step.id)), state.dependencies);
  }
  return steps.map((item) => {
    const report = item.status === "completed" ? (item.output ?? item.activity) : "";
    const issues = openIssues(item, state.tasks)
      .filter((issue) => issue.stepId !== task.id)
      .map((issue) => issue.text);
    return {
      name: item.name,
      objective: item.objective || item.name,
      files: item.filesChanged,
      summary: report ? (report.length > REPORT_LIMIT ? `${report.slice(0, REPORT_LIMIT)}…` : report) : undefined,
      ...(issues.length ? { issues } : {}),
    };
  });
}

const LOOK_LINES = [
  "",
  "If the work has a page, look at it before you finish, at a wide and a narrow width and after the clicks that matter, and judge it the way a person would. Tests that pass do not prove it looks right. Once its server is running:",
  "- First use your own browser tool, if you have one (such as the Chrome or browser use plugin), even though a command line tool is offered next: the user wants to see you working in their browser. It works in the user's own Chrome: open a new tab for your page (without asking for it to be visible, which their Chrome cannot do) and leave their other tabs alone. If it is missing, or refuses the page or a site you need, do not retry it; use Shepherd's screenshots for the rest of this step.",
  '- Otherwise use Shepherd\'s screenshots, since a browser cannot start in your sandbox: node "$SHEPHERD_LOOK" http://localhost:PORT/path [--width 390] [--full] [--click "CSS selector"] [--type "text"] [--press Enter] [--wait 500]',
  "  Clicks, typing and key presses happen in the order given, before the screenshot. It prints the PNG's path and any errors the page logged; open the PNG with your image viewing tool.",
  '  Start the server in the same command, for example: PORT=8130 node server.mjs & sleep 1; node "$SHEPHERD_LOOK" http://localhost:8130/; kill $!',
];

export function taskPrompt(task: Task, extra?: string, upstream: UpstreamContext[] = [], options: PromptOptions = {}): string {
  const followUp = extra?.trim() ?? "";
  const earlier = task.instructions.filter((line) => line !== followUp);
  const inputs = upstream.map((item) =>
    [
      `- ${item.name}: ${item.objective}`,
      item.files.length ? `  Files it wrote: ${item.files.join(", ")}` : "  It did not write any files.",
      item.summary && !task.independent ? `  What it reported:\n${indent(item.summary)}` : "",
      item.issues?.length ? `  Known issues someone noted in its work and left for later:\n${indent(item.issues.map((issue) => `- ${issue}`).join("\n"))}` : "",
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
    options.taskBranch ? `This step belongs to task branch ${options.taskBranch}. Accepted work collects there; the project checkout stays untouched.` : "",
    options.pushed
      ? `Shepherd has pushed the task branch ${options.pushed.branch} to remote ${options.pushed.remote}. Its base branch is ${options.pushed.base}. You may create or update a merge request (or pull request) from that task branch into its base with glab, gh or your own tools. Use the named remote's repository. Do not commit or push yourself. Finish with the merge request's full URL on its own line.`
      : "",
    `Task: ${task.name}`,
    `Objective: ${task.objective || task.name}`,
    task.description && task.description !== task.objective ? `Context: ${task.description}` : "",
    task.acceptance.length ? ["", "Done when:", ...task.acceptance.map((line) => `- ${line}`)].join("\n") : "",
    ...checkLines,
    ...(options.look ? LOOK_LINES : []),
    "",
    inputs.length ? "Earlier steps this one builds on. Their work is already merged into this worktree:" : "",
    ...inputs,
    inputs.length && task.independent
      ? "You are an independent check on that work. Shepherd does not give you the upstream agents' own accounts of it, so judge it from the files and the criteria above."
      : "",
    earlier.length ? ["Earlier instructions:", ...earlier.map((line) => `- ${line}`)].join("\n") : "",
    followUp ? `\nNew instruction:\n${followUp}\n` : "",
    task.sessionId
      ? "You have worked on this step before in this conversation. Do the work again now, with your commands and tools, instead of repeating earlier results: the files, the pages and the tools may have changed since then."
      : "",
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
