import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dependencyOrder } from "../src/model/outline";
import { openIssues } from "../src/model/stage";
import type { OrchestrationState, Task } from "../src/model/types";
import { agentEnv } from "./runner";

export interface DraftStep {
  name: string;
  prompt: string;
  depth: number;
}

export const MAX_DRAFT_STEPS = 12;
const DRAFT_TIMEOUT_MS = 240_000;

export function draftPrompt(goal: string): string {
  return [
    "Plan the goal below as steps for coding agents. Do not change any files; only plan.",
    "",
    "How the steps run: each step is done by one agent (Codex or Claude Code) on its own git branch of the repository in the current directory.",
    "A step starts with the work of the steps before it merged in, and their final reports in its prompt.",
    "If the repository already has code, look around first so the steps fit what is there.",
    "",
    "Goal:",
    goal.trim(),
    "",
    "Rules:",
    "- 2 to 8 steps. Fewer is better. Do not add steps nobody needs, and do not add a step that only plans or only reviews unless the goal asks for it.",
    "- Steps run top to bottom. A step with depth 1 runs at the same time as the other depth-1 steps directly under the depth-0 step before them, after that step. The next depth-0 step waits for all of them. Use depth 1 only for work that is truly independent; otherwise use depth 0.",
    '- "name": a short imperative title, under 60 characters.',
    '- "prompt": what the agent should do and how it can tell it is done, in 1 to 4 sentences, written to the agent.',
    "",
    'Reply with only this JSON and nothing else, no code fence: {"steps":[{"name":"...","prompt":"...","depth":0}]}',
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
export async function draftSteps(goal: string, folder: string, signal?: AbortSignal): Promise<DraftStep[] | { error: string }> {
  const answer = await askCodex(draftPrompt(goal), folder, signal, "steps");
  return "error" in answer ? answer : parseDraft(answer.reply);
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
export async function draftChecklist(input: ChecklistInput, folder: string, signal?: AbortSignal): Promise<{ text: string } | { error: string }> {
  const answer = await askCodex(checklistPrompt(input), folder, signal, "a checklist");
  if ("error" in answer) return answer;
  const text = parseChecklist(answer.reply);
  return typeof text === "string" ? { text } : text;
}

/** Runs Codex read-only and ephemeral in the folder, and returns its final message. */
function askCodex(prompt: string, folder: string, signal: AbortSignal | undefined, what: string): Promise<{ reply: string } | { error: string }> {
  const scratch = mkdtempSync(path.join(tmpdir(), "shepherd-draft-"));
  const answer = path.join(scratch, "answer.txt");
  const args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "--color", "never", "-o", answer, prompt];
  return new Promise((resolve) => {
    const child = spawn("codex", args, { cwd: folder, env: agentEnv("codex", process.env), stdio: ["ignore", "ignore", "pipe"], detached: true });
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
    const timer = setTimeout(stop, DRAFT_TIMEOUT_MS);
    signal?.addEventListener("abort", stop, { once: true });
    const finish = (result: { reply: string } | { error: string }) => {
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
      const last = stderr
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !/^\d{4}-\d{2}-\d{2}T/.test(line))
        .at(-1);
      finish({ error: code === null ? "Drafting took too long and was stopped." : `Codex could not draft ${what}${last ? `: ${last}` : "."}` });
    });
  });
}
