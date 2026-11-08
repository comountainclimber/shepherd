import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dependencyOrder } from "../src/model/outline";
import { openIssues } from "../src/model/stage";
import type { OrchestrationState, Task } from "../src/model/types";
import { agentEnv, codexBin, codexModelArgs } from "./runner";

/** The model and thinking to ask Codex with. Unset leaves it to Codex's settings. */
type Choice = Pick<Task, "model" | "effort">;

/** Why Codex gave no answer, and whether it was because it refused the model. */
type NoAnswer = { error: string; refusedModel?: boolean };

export interface DraftStep {
  name: string;
  prompt: string;
  depth: number;
}

export const MAX_DRAFT_STEPS = 12;
const DRAFT_TIMEOUT_MS = 240_000;

export const MAP_RULES = [
  "- Each agent step is one sitting of work that ends in something checkable: a passing test, a changed page, a file.",
  "- Steps that touch different files and need nothing from each other sit side by side, at depth 1 under the step they both need. They run after that step and at the same time as each other.",
  "- A step that needs several earlier steps comes after them at the left edge (depth 0), so it waits for all of them. The first step has depth 0.",
  "- Every agent step has one to three Done when lines a reviewer can verify, and a check command when the repository has tests.",
  "- When a person has to look (a page, copy, a product call), the map ends with a step for a person that says what to try.",
  "- No step only plans or only reviews unless the goal asks for it.",
  "- Each step's name is a verb and the thing it changes, under 60 characters.",
  "- Three to eight steps; one step only when the goal is a single small change.",
].join("\n");

export function draftPrompt(goal: string): string {
  return [
    "Draft a map for the goal below. Do not change any files; only plan.",
    "",
    "How the steps run: each agent step is done by one agent (Codex or Claude Code) on its own git branch of the repository in the current directory. A human step is done by a person.",
    "A step starts with the work of the steps it depends on merged in, and their final reports in its prompt. Outline depth sets which steps it waits for, as described in the rules below.",
    "If the repository already has code, look around first so the steps fit what is there.",
    "",
    "Goal:",
    goal.trim(),
    "",
    "Rules:",
    MAP_RULES,
    "",
    "Reply fields:",
    '- "prompt": what to do, in 1 to 4 sentences, written to the agent or person doing the step.',
    '- "runner": "agent" or "human"; default to "agent".',
    '- "acceptance": an array of the step\'s Done when lines, each stating an outcome a reviewer can verify.',
    '- "checkCommand": the repository command that checks the agent\'s work; use an empty string when there are no tests. It does not apply to a person, so use an empty string for a human step.',
    "",
    'Reply with only this JSON and nothing else, no code fence: {"steps":[{"name":"...","prompt":"...","depth":0,"runner":"agent","acceptance":["..."],"checkCommand":""}]}',
  ].join("\n");
}

/** Reads the steps out of the agent's reply, tolerating prose or a code fence around the JSON. */
export function parseDraft(reply: string): DraftStep[] | { error: string } {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return { error: "The agent did not reply with a plan." };
  let raw: unknown;
  try {
    raw = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return { error: "The agent's plan was not valid JSON." };
  }
  const list = (raw as { steps?: unknown })?.steps;
  if (!Array.isArray(list)) return { error: "The agent's plan had no steps." };
  const steps = list.flatMap((item): DraftStep[] => {
    const step = item as Record<string, unknown> | null;
    const name = typeof step?.name === "string" ? step.name.trim().slice(0, 120) : "";
    const prompt = typeof step?.prompt === "string" ? step.prompt.trim().slice(0, 4000) : "";
    if (!name) return [];
    const depth = step?.depth === 1 || step?.depth === 2 ? step.depth : 0;
    return [{ name, prompt, depth }];
  });
  if (!steps.length) return { error: "The agent's plan had no usable steps." };
  return steps.slice(0, MAX_DRAFT_STEPS).map((step, index) => (index === 0 ? { ...step, depth: 0 } : step));
}

/** Asks Codex, which may read the project folder but not change it, to break a goal into steps. */
export async function draftSteps(goal: string, folder: string, choice: Choice, signal?: AbortSignal): Promise<DraftStep[] | { error: string }> {
  const answer = await askCodex(draftPrompt(goal), folder, choice, signal, "steps");
  if ("error" in answer) return { error: answer.refusedModel ? `${answer.error} Pick another model and try again.` : answer.error };
  return parseDraft(answer.reply);
}

export interface ChecklistInput {
  project: { name: string; summary: string };
  step: { name: string; objective: string };
  /** The folder the person tries the work in, when Shepherd has made it. */
  folder: string | null;
  /** Every step before this one, in the order they ran. */
  earlier: { name: string; objective: string; files: string[]; report?: string; issues: string[] }[];
}

const CHECKLIST_PROMPT_LIMIT = 800;
const CHECKLIST_REPORT_LIMIT = 2000;
const CHECKLIST_LIMIT = 6000;

/** What a person's step needs to know to check the work of every step before it. */
export function checklistInput(state: OrchestrationState, task: Task): ChecklistInput {
  const before = new Set<string>();
  for (let queue = [task.id]; queue.length; ) {
    const next = queue.shift()!;
    for (const dep of state.dependencies) {
      if (dep.target !== next || before.has(dep.source)) continue;
      before.add(dep.source);
      queue.push(dep.source);
    }
  }
  const project = state.projects.find((item) => item.id === task.projectId);
  const steps = dependencyOrder(
    state.tasks.filter((item) => item.projectId === task.projectId),
    state.dependencies,
  ).filter((item) => before.has(item.id));
  const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit)}…` : text);
  return {
    project: { name: project?.name ?? "", summary: project?.summary ?? "" },
    step: { name: task.name, objective: task.objective.trim() === task.name.trim() ? "" : task.objective },
    folder: task.git?.folder ?? null,
    earlier: steps.map((item) => {
      const report = item.status === "completed" ? (item.output ?? item.activity) : "";
      return {
        name: item.name,
        objective: clip(item.objective || item.name, CHECKLIST_PROMPT_LIMIT),
        files: item.filesChanged.slice(0, 30),
        ...(report ? { report: clip(report, CHECKLIST_REPORT_LIMIT) } : {}),
        issues: openIssues(item, state.tasks).map((issue) => issue.text),
      };
    }),
  };
}

export function checklistPrompt(input: ChecklistInput): string {
  const earlier = input.earlier.map((item) =>
    [
      `- ${item.name}: ${item.objective}`,
      item.files.length ? `  Files it wrote: ${item.files.join(", ")}` : "",
      item.report ? `  What it reported:\n${item.report.replace(/^/gm, "    ")}` : "",
      item.issues.length ? `  Known issues noted in it: ${item.issues.join(" / ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    "Write the checklist a person follows to try a finished piece of work by hand: the last check before it is accepted. Do not change any files; only read them.",
    "",
    `The project: ${input.project.name}${input.project.summary ? `. ${input.project.summary}` : ""}`,
    `The person's step: ${input.step.name}`,
    input.step.objective ? `What the step says now. Keep whatever still applies:\n${input.step.objective}` : "",
    input.folder
      ? `The current directory is the person's folder, ${input.folder}. It has the work of every step below merged together.`
      : "The current directory is the project folder.",
    "Read its README, package.json and code to find out how to start the work and what it does.",
    "",
    "The steps before it, in the order they ran:",
    ...earlier,
    "",
    "The checklist:",
    "- Start with how to start it: the exact command to run in that folder, and where to open it.",
    "- Then 4 to 10 numbered checks. Each is one thing to do and what the person should see if it works.",
    "- Spend them on what tests and agents miss: how it looks, real clicks and typing, flows that cross several steps' work, and edge cases such as reloading, the back button, links that carry state, a narrow window, using only the keyboard, and empty or wrong input. Skip what a test already proves.",
    "- Include everything a report above asked a person to check by eye, and a way to see each known issue.",
    '- End with: if something is wrong, use "Send it back" to send it to the step that owns it, or "keep it as a known issue" to leave it for later; mark the step done when you are happy with it.',
    "- Plain text with numbered lines. No headings and no Markdown emphasis.",
    "",
    "Reply with only the checklist.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** Cleans the agent's checklist: no code fence, no preamble before the first line that matters. */
export function parseChecklist(reply: string): string | { error: string } {
  const text = reply
    .trim()
    .replace(/^```[\w-]*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
  if (!text) return { error: "The agent did not write a checklist." };
  return text.length > CHECKLIST_LIMIT ? `${text.slice(0, CHECKLIST_LIMIT)}…` : text;
}

/** Asks Codex, which may read the folder but not change it, for a person's checklist. */
export async function draftChecklist(input: ChecklistInput, folder: string, choice: Choice, signal?: AbortSignal): Promise<{ text: string } | { error: string }> {
  const answer = await askCodex(checklistPrompt(input), folder, choice, signal, "a checklist");
  if ("error" in answer) return { error: answer.error };
  const text = parseChecklist(answer.reply);
  return typeof text === "string" ? { text } : text;
}

/** The last thing Codex said on stderr, with an API error's JSON reduced to its message. */
export function codexError(stderr: string): { text: string; refusedModel: boolean } {
  const last =
    stderr
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^\d{4}-\d{2}-\d{2}T/.test(line))
      .at(-1) ?? "";
  try {
    const body = JSON.parse(last.slice(last.indexOf("{"))) as { error?: { message?: unknown; code?: unknown } };
    if (typeof body.error?.message === "string") return { text: body.error.message, refusedModel: body.error.code === "model_not_found" };
  } catch {
    // Not JSON, so the line is already plain text.
  }
  return { text: last, refusedModel: false };
}

/** Codex's command for a read-only, ephemeral answer written to a file. */
export function askArgs(prompt: string, answer: string, choice: Choice): string[] {
  return ["exec", ...codexModelArgs(choice), "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "--color", "never", "-o", answer, prompt];
}

/** Runs Codex read-only and ephemeral in the folder, and returns its final message. */
export function askCodex(prompt: string, folder: string, choice: Choice, signal: AbortSignal | undefined, what: string): Promise<{ reply: string } | NoAnswer> {
  if (signal?.aborted) return Promise.resolve({ error: "Codex run stopped." });
  const scratch = mkdtempSync(path.join(tmpdir(), "shepherd-draft-"));
  const answer = path.join(scratch, "answer.txt");
  const args = askArgs(prompt, answer, choice);
  return new Promise((resolve) => {
    const child = spawn(codexBin(), args, { cwd: folder, env: agentEnv("codex", process.env), stdio: ["ignore", "ignore", "pipe"], detached: true });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000);
    });
    const stop = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    };
    let finished = false;
    const timer = setTimeout(stop, DRAFT_TIMEOUT_MS);
    signal?.addEventListener("abort", stop, { once: true });
    const finish = (result: { reply: string } | NoAnswer) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      rmSync(scratch, { recursive: true, force: true });
      resolve(result);
    };
    child.once("error", (error) => finish({ error: `Could not start Codex: ${error.message}` }));
    child.once("close", (code) => {
      let reply = "";
      try {
        reply = readFileSync(answer, "utf8");
      } catch {
        // No answer file means Codex stopped before it replied.
      }
      if (reply.trim()) return finish({ reply });
      if (code === null) return finish({ error: "Codex took too long and was stopped." });
      const why = codexError(stderr);
      finish({ error: `Codex could not draft ${what}${why.text ? `: ${why.text}` : "."}`, ...(why.refusedModel ? { refusedModel: true } : {}) });
    });
  });
}
