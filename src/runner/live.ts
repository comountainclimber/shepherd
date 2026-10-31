import type { Task } from "../model/types";
import { agentById } from "../model/workspace";
import { useShepherd } from "../store";

/** The folder that holds every project. Empty means the server's default. */
export function workspacePath(): string {
  return useShepherd.getState().state.workspace ?? "";
}

export function setWorkspacePath(path: string) {
  useShepherd.getState().dispatch({ type: "setWorkspace", path });
}

interface AgentStatus {
  claude: boolean;
  codex: boolean;
  git: boolean;
  workspace: string;
}

export async function agentStatus(): Promise<AgentStatus> {
  const response = await fetch("/api/agents");
  if (!response.ok) return { claude: false, codex: false, git: false, workspace: "" };
  return (await response.json()) as AgentStatus;
}

/**
 * Runs, checks and merges happen on the server, so they keep going with no tab open. Returns the
 * server's reason when it refuses, and also shows it.
 */
async function command(body: Record<string, unknown>): Promise<string | null> {
  try {
    const response = await fetch("/api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as { error?: string };
    if (response.ok) return null;
    const problem = result.error ?? `The server refused (${response.status}).`;
    useShepherd.getState().setProblem(problem);
    return problem;
  } catch {
    const problem = "Could not reach the Shepherd server.";
    useShepherd.getState().setProblem(problem);
    return problem;
  }
}

export function runTask(taskId: string, extra?: string) {
  return command({ command: "run", taskId, extra });
}

export function stopTask(taskId: string, status: "blocked" | "queued") {
  return command({ command: "stop", taskId, status });
}

export function instructTask(taskId: string, text: string) {
  const trimmed = text.trim();
  return trimmed ? command({ command: "instruct", taskId, text: trimmed }) : Promise.resolve(null);
}

export function runCheck(taskId: string) {
  return command({ command: "check", taskId });
}

export function markComplete(taskId: string) {
  return command({ command: "complete", taskId });
}

/** Merges a verified task's branch into the project folder's branch. Returns an error to show, or null. */
export function mergeTask(taskId: string): Promise<string | null> {
  return command({ command: "merge", taskId });
}

/** Sends a task's failed check to an upstream task that owns the cause, and runs that task. */
export function forwardFailure(taskId: string, to: string): Promise<string | null> {
  return command({ command: "forward", taskId, to });
}

export function runLabel(task: Task): string {
  const verb = task.status === "failed" ? "Retry" : task.status === "completed" ? "Run again" : "Run";
  return `${verb} with ${providerFor(task) === "codex" ? "Codex" : "Claude"}`;
}

function providerFor(task: Task): "claude" | "codex" {
  return agentById(task.agentId)?.provider === "claude-code" ? "claude" : "codex";
}

/** Each check gets its own evidence folder on the server; this is where one of its files is served. */
export function evidenceUrl(taskId: string, file: string): string {
  return `/api/evidence/${encodeURIComponent(taskId)}/${file.split("/").map(encodeURIComponent).join("/")}`;
}
