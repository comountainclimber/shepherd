import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CODEX_MODEL } from "../src/model/workspace";
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
export function draftSteps(goal: string, folder: string, signal?: AbortSignal): Promise<DraftStep[] | { error: string }> {
  const scratch = mkdtempSync(path.join(tmpdir(), "shepherd-draft-"));
  const answer = path.join(scratch, "answer.txt");
  const args = [
    "exec",
    "-m",
    CODEX_MODEL,
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--color",
    "never",
    "-o",
    answer,
    draftPrompt(goal),
  ];
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
    const finish = (result: DraftStep[] | { error: string }) => {
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
      if (reply.trim()) return finish(parseDraft(reply));
      const last = stderr
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !/^\d{4}-\d{2}-\d{2}T/.test(line))
        .at(-1);
      finish({ error: code === null ? "Drafting took too long and was stopped." : `Codex could not draft steps${last ? `: ${last}` : "."}` });
    });
  });
}
