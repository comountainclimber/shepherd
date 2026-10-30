import type { CheckRun, Task } from "../model/types";
import { isFullyVerified } from "../model/verify";
import { agentById } from "../model/workspace";
import { useShepherd } from "../store";
import { taskPrompt, type UpstreamContext } from "./prompt";

const WORKSPACE_KEY = "shepherd.workspace";
const controllers = new Map<string, AbortController>();

export function workspacePath(): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(WORKSPACE_KEY) ?? "";
}

export function setWorkspacePath(path: string) {
  localStorage.setItem(WORKSPACE_KEY, path);
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

export async function runTask(taskId: string, extra?: string) {
  const store = useShepherd.getState();
  const task = store.state.tasks.find((item) => item.id === taskId);
  if (!task || task.runner === "human") return;
  store.dispatch({ type: "setStatus", id: taskId, status: "running" });
  const current = useShepherd.getState().state.tasks.find((item) => item.id === taskId);
  if (!current || current.status !== "running") return;
  store.dispatch({ type: "updateTask", id: taskId, patch: { activity: "Starting the agent…", blocker: null } });
  await streamRun(current, extra);
}

export async function stopTask(taskId: string, status: "blocked" | "queued") {
  controllers.get(taskId)?.abort();
  controllers.delete(taskId);
  await fetch("/api/runs/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId }),
  }).catch(() => undefined);
  useShepherd.getState().dispatch({ type: "setStatus", id: taskId, status });
}

export async function instructTask(taskId: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const store = useShepherd.getState();
  store.dispatch({ type: "instruct", id: taskId, text: trimmed });
  const task = useShepherd.getState().state.tasks.find((item) => item.id === taskId);
  if (!task || task.runner === "human" || !task.sessionId) return;
  if (task.status === "running") {
    store.dispatch({ type: "updateTask", id: taskId, patch: { activity: "Instruction saved for the next run" } });
    return;
  }
  await runTask(taskId, trimmed);
}

function upstreamTasks(task: Task): Task[] {
  const { tasks, dependencies } = useShepherd.getState().state;
  return dependencies
    .filter((dep) => dep.target === task.id)
    .map((dep) => tasks.find((item) => item.id === dep.source))
    .filter((item): item is Task => !!item);
}

function upstreamContext(task: Task): UpstreamContext[] {
  return upstreamTasks(task).map((item) => ({
    name: item.name,
    objective: item.objective,
    files: item.filesChanged,
    summary: item.status === "completed" ? item.activity : undefined,
  }));
}

async function streamRun(task: Task, extra?: string) {
  controllers.get(task.id)?.abort();
  const controller = new AbortController();
  controllers.set(task.id, controller);
  const workspace = workspacePath();
  const project = useShepherd.getState().state.projects.find((item) => item.id === task.projectId);
  let response: Response;
  try {
    response = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        taskId: task.id,
        name: task.name,
        workspace,
        directory: project?.directory ?? "",
        worktree: task.worktree,
        branch: task.git?.branch,
        upstream: upstreamTasks(task).flatMap((item) => (item.git ? [item.git.branch] : [])),
        prompt: taskPrompt(task, extra, upstreamContext(task)),
        provider: providerFor(task),
        resumeId: task.sessionId ?? null,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    fail(task.id, error instanceof Error ? error.message : "Could not reach the agent runner.");
    return;
  }
  if (!response.ok || !response.body) {
    const message = await response.text();
    fail(task.id, message || `Agent runner returned ${response.status}`);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let settled = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: LiveEvent;
        try {
          event = JSON.parse(line) as LiveEvent;
        } catch {
          continue;
        }
        if (event.kind === "result" || event.kind === "error") settled = true;
        applyEvent(task.id, event);
        if (event.kind === "exit" && !settled) {
          settled = true;
          const code = event.code ?? 1;
          if (code === 0) finish(task.id, event.files || "The agent finished");
          else fail(task.id, event.error ? `The agent exited with code ${code}: ${event.error}` : `The agent exited with code ${code}.`);
        }
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) fail(task.id, error instanceof Error ? error.message : "The agent stream broke.");
  } finally {
    if (controllers.get(task.id) === controller) controllers.delete(task.id);
  }
  const latest = useShepherd.getState().state.tasks.find((item) => item.id === task.id);
  if (!controller.signal.aborted && latest?.status === "completed" && latest.checkCommand) await runCheck(task.id);
}

export async function runCheck(taskId: string) {
  const store = useShepherd.getState();
  const task = store.state.tasks.find((item) => item.id === taskId);
  const command = task?.checkCommand;
  if (!task || !command) return;
  const project = store.state.projects.find((item) => item.id === task.projectId);
  store.dispatch({ type: "startCheck", taskId });
  const started = Date.now();
  let run: CheckRun;
  try {
    const response = await fetch("/api/checks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace: workspacePath(), directory: project?.directory ?? "", branch: task.git?.branch, command }),
    });
    const body = (await response.json()) as Partial<CheckRun> & { error?: string };
    run = response.ok
      ? {
          command,
          exitCode: body.exitCode ?? null,
          output: body.output ?? "",
          durationMs: body.durationMs ?? Date.now() - started,
          timedOut: body.timedOut,
        }
      : { command, exitCode: null, output: body.error ?? `The check runner returned ${response.status}.`, durationMs: Date.now() - started };
  } catch (error) {
    run = {
      command,
      exitCode: null,
      output: error instanceof Error ? error.message : "Could not reach the check runner.",
      durationMs: Date.now() - started,
    };
  }
  useShepherd.getState().dispatch({ type: "recordCheck", taskId, run });
}

/** Merges a verified task's branch into the project folder's branch. Returns an error to show, or null. */
export async function mergeTask(taskId: string): Promise<string | null> {
  const { tasks, projects } = useShepherd.getState().state;
  const task = tasks.find((item) => item.id === taskId);
  if (!task?.git) return "This task has no branch yet. Run it first.";
  if (!isFullyVerified(task)) return "Verify the task before merging it.";
  const project = projects.find((item) => item.id === task.projectId);
  try {
    const response = await fetch("/api/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspace: workspacePath(), directory: project?.directory ?? "", branch: task.git.branch, name: task.name }),
    });
    const body = (await response.json()) as { into?: string; sha?: string; error?: string };
    if (!response.ok || !body.into || !body.sha) return body.error ?? `The merge failed with status ${response.status}.`;
    useShepherd.getState().dispatch({ type: "merged", id: taskId, into: body.into, sha: body.sha });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Could not reach the Shepherd server.";
  }
}

export async function markComplete(taskId: string) {
  const store = useShepherd.getState();
  store.dispatch({ type: "setStatus", id: taskId, status: "completed" });
  const task = useShepherd.getState().state.tasks.find((item) => item.id === taskId);
  if (task?.status === "completed" && task.checkCommand) await runCheck(taskId);
}

interface LiveEvent {
  kind?: string;
  text?: string;
  id?: string;
  ok?: boolean;
  summary?: string;
  error?: string;
  code?: number;
  files?: string;
  changed?: string[];
  opened?: { path: string; text: string }[];
  head?: string;
  branch?: string;
  folder?: string;
  target?: string;
}

function applyEvent(taskId: string, event: LiveEvent) {
  const dispatch = useShepherd.getState().dispatch;
  const task = () => useShepherd.getState().state.tasks.find((item) => item.id === taskId);
  if (event.kind === "started" && event.branch && event.folder) {
    const git = { ...task()?.git, branch: event.branch, folder: event.folder, target: event.target ?? "main" };
    dispatch({ type: "updateTask", id: taskId, patch: { git } });
  }
  if (event.kind === "chat" && event.id) {
    dispatch({ type: "updateTask", id: taskId, patch: { sessionId: event.id } });
  }
  if (event.kind === "activity" && event.text) {
    dispatch({ type: "updateTask", id: taskId, patch: { activity: event.text } });
  }
  if (event.kind === "result") {
    if (event.ok === false) fail(taskId, event.summary || "The agent failed.");
    else finish(taskId, event.summary || "The agent finished");
  }
  const git = task()?.git;
  if (event.kind === "exit" && event.changed && git) {
    dispatch({
      type: "updateTask",
      id: taskId,
      patch: { filesChanged: event.changed, previews: event.opened ?? [], git: { ...git, head: event.head } },
    });
  }
  if (event.kind === "error") fail(taskId, event.error || "The agent failed to start.");
}

function finish(taskId: string, summary: string) {
  const dispatch = useShepherd.getState().dispatch;
  dispatch({ type: "setStatus", id: taskId, status: "completed" });
  dispatch({ type: "updateTask", id: taskId, patch: { activity: summary } });
}

export function runLabel(task: Task): string {
  const verb = task.status === "failed" ? "Retry" : task.status === "completed" ? "Run again" : "Run";
  return `${verb} with ${providerFor(task) === "codex" ? "Codex" : "Claude"}`;
}

function providerFor(task: Task): "claude" | "codex" {
  return agentById(task.agentId)?.provider === "claude-code" ? "claude" : "codex";
}

function fail(taskId: string, message: string) {
  const dispatch = useShepherd.getState().dispatch;
  dispatch({ type: "updateTask", id: taskId, patch: { blocker: message, activity: message } });
  dispatch({ type: "setStatus", id: taskId, status: "failed" });
}
