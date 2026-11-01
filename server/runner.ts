import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { slugify } from "../src/model/factory";
import { isEffort, isModelId } from "../src/model/models";
import { dependencyOrder } from "../src/model/outline";
import type { Action, CheckRun, GateStep, OrchestrationState, Task } from "../src/model/types";
import { isFullyVerified, unmetDependencies } from "../src/model/verify";
import { agentById } from "../src/model/workspace";
import { parseAgentLine } from "../src/runner/parse";
import { taskPrompt, upstreamContext, upstreamTasks } from "../src/runner/prompt";
import type { Engine } from "./engine";
import {
  changes,
  commitAll,
  ensureRepo,
  isTaskBranch,
  isTaskName,
  mergeBranch,
  openWorktree,
  personAuthor,
  prepareRun,
  serialized,
  worktreeFolder,
  type Author,
  type Changes,
} from "./git";

export type AgentCli = "claude" | "codex";

export const AUTHORS: Record<AgentCli, Author> = {
  codex: { name: "Codex", email: "codex@shepherd.local" },
  claude: { name: "Claude Code", email: "claude-code@shepherd.local" },
};

/** Automatic reruns of a task set to run automatically, after its check fails. */
export const MAX_RETRIES = 2;
/** How much of an agent's final message Shepherd keeps as the step's report. */
const REPORT_LIMIT = 12_000;
/** Agents Shepherd starts on its own at once. Runs you start are not counted. */
export const MAX_PARALLEL_RUNS = 4;

export interface RunnerOptions {
  engine: Engine;
  /** The workspace used when the board has none set. */
  sandbox: string;
  worktrees: string;
  /** Each check gets a fresh folder here for its evidence. */
  evidence: string;
  /** Shepherd's gate script, given to checks and agents as SHEPHERD_GATE. */
  gate: string;
  checkTimeoutMs?: number;
  command?: (provider: AgentCli, prompt: string, resumeId: string | null, choice: Pick<Task, "model" | "effort">) => { cmd: string; args: string[] };
  loggedIn?: (provider: AgentCli) => Promise<boolean>;
  /** Lets agents and checks ask for screenshots: the script they run, and Shepherd's address once it listens. */
  look?: { script: string; server: () => string | null };
  /** Writes the checklist for a step a person does, from the work of the steps before it. */
    checklist?: (board: OrchestrationState, task: Task, signal: AbortSignal) => Promise<{ text: string } | { error: string }>;
}

export interface Runner {
  handle(command: unknown): Promise<{ ok: true } | { error: string }>;
  /** Kills a task's agent without touching the board, before the task is deleted. */
  cancel(taskId: string): void;
  cancelAll(): void;
  /** Stops every agent and check for good, for when this server is being replaced. */
  close(): void;
  schedule(): void;
  /** Resolves once nothing is running or scheduled. */
  idle(): Promise<void>;
}

interface Attempt {
  stopped: boolean;
  child: ChildProcess | null;
  scheduled: boolean;
}

export function createRunner(options: RunnerOptions): Runner {
  const { engine, sandbox, worktrees, evidence, gate } = options;
  const command = options.command ?? agentCommand;
  const loggedIn = options.loggedIn ?? cachedLogin();
  const runs = new Map<string, Attempt>();
  const checks = new Set<string>();
  const refreshing = new Set<string>();
  const work = new Set<Promise<unknown>>();
  const closing = new AbortController();
  const closed = () => closing.signal.aborted;
  let tick: ReturnType<typeof setTimeout> | null = null;

  const state = () => engine.get();
  const find = (id: string) => state().tasks.find((task) => task.id === id);
  const dispatch = (action: Action) => engine.dispatch(action);
  const track = (promise: Promise<unknown>) => {
    const settled = promise.catch((error) => console.error("[shepherd]", error)).finally(() => work.delete(settled));
    work.add(settled);
  };

  function fail(taskId: string, message: string): string {
    dispatch({ type: "updateTask", id: taskId, patch: { blocker: message, activity: message } });
    dispatch({ type: "setStatus", id: taskId, status: "failed" });
    return message;
  }

  /** What an agent or check needs in its environment to ask Shepherd for a screenshot. */
  function lookEnv(taskId: string): Record<string, string> {
    const server = options.look?.server();
    return options.look && server ? { SHEPHERD_LOOK: options.look.script, SHEPHERD_URL: server, SHEPHERD_TASK_ID: taskId } : {};
  }

  function finish(taskId: string, summary: string) {
    dispatch({ type: "setStatus", id: taskId, status: "completed" });
    dispatch({ type: "updateTask", id: taskId, patch: { activity: summary } });
  }

  function folderFor(task: Task) {
    const board = state();
    const project = board.projects.find((item) => item.id === task.projectId);
    return projectFolder(board.workspace, project?.directory, sandbox);
  }

  function kill(taskId: string) {
    const attempt = runs.get(taskId);
    if (!attempt) return;
    attempt.stopped = true;
    if (attempt.child) killGroup(attempt.child);
    runs.delete(taskId);
  }

  async function run(taskId: string, extra: string | undefined, manual: boolean): Promise<string | null> {
    const task = find(taskId);
    if (!task) return "There is no such task.";
    if (task.runner === "human") return "A person does this task. Mark it complete when it is done.";
    if (closed()) return "Shepherd is restarting. Try again in a moment.";
    kill(taskId);
    const attempt: Attempt = { stopped: false, child: null, scheduled: !manual };
    runs.set(taskId, attempt);
    try {
      return await execute(task, attempt, extra, manual);
    } catch (error) {
      return attempt.stopped ? null : fail(taskId, `Shepherd hit an error running this task: ${message(error)}`);
    } finally {
      if (runs.get(taskId) === attempt) runs.delete(taskId);
      schedule();
    }
  }

  async function execute(task: Task, attempt: Attempt, extra: string | undefined, manual: boolean): Promise<string | null> {
    const taskId = task.id;
    if (manual && task.retries) dispatch({ type: "updateTask", id: taskId, patch: { retries: undefined } });
    dispatch({ type: "setStatus", id: taskId, status: "running" });
    const current = find(taskId);
    if (current?.status !== "running") return current?.blocker ?? "The task could not start.";
    dispatch({ type: "updateTask", id: taskId, patch: { activity: "Starting the agent…", blocker: null } });
    if (!current.git) {
      const worktree = branchName(current, state().tasks);
      if (worktree !== current.worktree) dispatch({ type: "updateTask", id: taskId, patch: { worktree } });
    }
    const named = find(taskId) ?? current;
    const provider = providerFor(current);
    const author = AUTHORS[provider];
    const dir = folderFor(current);
    if ("error" in dir) return fail(taskId, dir.error);
    if (!isTaskName(named.worktree)) return fail(taskId, `Not a usable task folder name: ${named.worktree}`);
    if (!(await loggedIn(provider))) return attempt.stopped ? null : fail(taskId, `${author.name} is not logged in.`);
    if (attempt.stopped) return null;

    const before = current.git?.head;
    let tree: Awaited<ReturnType<typeof openWorktree>>;
    let merged: string[];
    try {
      [tree, merged] = await serialized(dir.path, async () => {
        const repo = await ensureRepo(dir.path);
        const opened = await openWorktree(repo, worktrees, taskId, named.worktree, current.git?.branch);
        return [opened, await prepareRun(opened, branches(upstreamTasks(state(), current)), author)] as const;
      });
    } catch (error) {
      return attempt.stopped ? null : fail(taskId, message(error));
    }
    if (attempt.stopped || !find(taskId)) return null;
    dispatch({
      type: "updateTask",
      id: taskId,
      patch: { git: { ...find(taskId)?.git, branch: tree.branch, folder: tree.folder, target: tree.target } },
    });
    if (merged.length) dispatch({ type: "updateTask", id: taskId, patch: { activity: `Merged ${merged.join(", ")} into ${tree.branch}` } });

    const latest = find(taskId)!;
    const tools = lookEnv(taskId);
    const prompt = taskPrompt(latest, extra, upstreamContext(state(), latest), { look: !!tools.SHEPHERD_LOOK });
    const spec = command(provider, prompt, latest.sessionId ?? null, { model: latest.model, effort: latest.effort });
    const child = spawn(spec.cmd, spec.args, {
      cwd: tree.folder,
      env: agentEnv(provider, { ...process.env, SHEPHERD_GATE: gate, ...tools }),
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    child.stdin?.end();
    attempt.child = child;

    let buffer = "";
    let lastActivity = "";
    let report = "";
    let result: { ok: boolean; summary: string } | null = null;
    let sessionId = latest.sessionId ?? null;
    const consume = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const parsed = parseAgentLine(line);
        if (!parsed || attempt.stopped) continue;
        if (parsed.chatId && parsed.chatId !== sessionId) {
          sessionId = parsed.chatId;
          dispatch({ type: "updateTask", id: taskId, patch: { sessionId } });
        }
        if (parsed.message) report = parsed.message;
        if (parsed.activity && parsed.activity !== lastActivity) {
          lastActivity = parsed.activity;
          dispatch({ type: "updateTask", id: taskId, patch: { activity: parsed.activity } });
        }
        if (parsed.done) {
          const summary = parsed.summary && parsed.summary !== "Codex finished" ? parsed.summary : lastActivity || parsed.summary || "";
          result = { ok: parsed.ok !== false, summary };
        }
      }
    };
    child.stdout?.on("data", consume);
    let stderrTail = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
      if (!text || /Reading additional input from stdin/.test(text)) return;
      stderrTail = `${stderrTail}\n${text}`.slice(-2000);
      const notice = withoutLogLines(text);
      if (notice && !attempt.stopped) dispatch({ type: "updateTask", id: taskId, patch: { activity: notice.slice(0, 240) } });
    });
    const { code, spawnError } = await new Promise<{ code: number | null; spawnError?: string }>((resolve) => {
      child.once("error", (error) => resolve({ code: null, spawnError: error.message }));
      child.once("close", (exit) => resolve({ code: exit }));
    });
    if (buffer.trim()) consume(Buffer.from("\n"));
    // A stopped run's changes stay uncommitted; the next run commits them before it starts.
    if (attempt.stopped || !find(taskId)) return null;

    const outcome = result as { ok: boolean; summary: string } | null;
    let diff: Changes;
    try {
      diff = await serialized(dir.path, async () => {
        await commitAll(tree.folder, [(current.name || "Shepherd step").slice(0, 72), (outcome?.summary ?? "").slice(0, 2000)], author);
        return changes(tree.folder, tree.branch);
      });
    } catch (error) {
      return fail(taskId, `Could not commit the run: ${message(error)}`);
    }
    const git = find(taskId)?.git;
    if (!git || attempt.stopped) return null;
    dispatch({
      type: "updateTask",
      id: taskId,
      patch: {
        filesChanged: diff.files,
        previews: diff.diffs,
        git: { ...git, head: diff.head },
        ...(report ? { output: report.length > REPORT_LIMIT ? `${report.slice(0, REPORT_LIMIT)}…` : report } : {}),
      },
    });
    const files = diff.files.length
      ? `${diff.files.length} ${diff.files.length === 1 ? "file" : "files"} changed on ${tree.branch}`
      : "No files changed";
    if (spawnError) fail(taskId, `Could not start ${author.name}: ${spawnError}`);
    else if (outcome?.ok === false) fail(taskId, outcome.summary || "The agent failed.");
    else if (code !== 0 && !outcome) {
      const error = exitError(stderrTail);
      fail(taskId, error ? `The agent exited with code ${code}: ${error}` : `The agent exited with code ${code}.`);
    } else finish(taskId, outcome?.summary || files);
    // The agent is done; what follows is the check, which a new run may replace.
    if (runs.get(taskId) === attempt) runs.delete(taskId);

    if (diff.head !== before) outdateDownstream(taskId, `${current.name} changed`);
    const done = find(taskId);
    if (done?.status === "completed") {
      if (done.outdated) await refresh(taskId);
      else if (done.checkCommand) await check(taskId);
    }
    return null;
  }

  /** Every task downstream of this one, nearest first. */
  function downstream(taskId: string): string[] {
    const { dependencies } = state();
    const seen = new Set<string>([taskId]);
    const order: string[] = [];
    for (let queue = [taskId]; queue.length; ) {
      const next = queue.shift()!;
      for (const dep of dependencies) {
        if (dep.source !== next || seen.has(dep.target)) continue;
        seen.add(dep.target);
        order.push(dep.target);
        queue.push(dep.target);
      }
    }
    return order;
  }

  function outdateDownstream(taskId: string, reason: string) {
    for (const id of downstream(taskId)) dispatch({ type: "outdate", id, reason });
  }

  /**
   * Brings new upstream work into an out-of-date task's branch and checks it again, without
   * rerunning its agent. A review still counts when the task's own diff is unchanged.
   */
  async function refresh(taskId: string): Promise<void> {
    const task = find(taskId);
    if (!task?.git || !task.outdated || refreshing.has(taskId) || runs.has(taskId) || closed()) return;
    refreshing.add(taskId);
    try {
      dispatch({ type: "updateTask", id: taskId, patch: { activity: "Bringing in upstream work…" } });
      const dir = folderFor(task);
      if ("error" in dir) {
        fail(taskId, dir.error);
        return;
      }
      const author = AUTHORS[providerFor(task)];
      let merged: string[];
      let diff: Changes;
      try {
        [merged, diff] = await serialized(dir.path, async () => {
          const repo = await ensureRepo(dir.path);
          const tree = await openWorktree(repo, worktrees, taskId, task.worktree, task.git?.branch);
          const brought = await prepareRun(tree, branches(upstreamTasks(state(), task)), author);
          return [brought, await changes(tree.folder, tree.branch)] as const;
        });
      } catch (error) {
        fail(taskId, `Could not bring in upstream work: ${message(error)}. Run the task to resolve it.`);
        return;
      }
      const latest = find(taskId);
      if (!latest?.outdated || runs.has(taskId) || closed()) return;
      dispatch({
        type: "refreshed",
        id: taskId,
        head: diff.head,
        merged,
        filesChanged: diff.files,
        previews: diff.diffs,
        keepReview: sameDiff(latest, diff),
      });
      if (diff.head !== task.git.head) outdateDownstream(taskId, `${task.name} brought in upstream work`);
    } finally {
      refreshing.delete(taskId);
      schedule();
    }
    if (find(taskId)?.status === "completed" && find(taskId)?.checkCommand) await check(taskId);
  }

  /**
   * Gives a step a person does its own worktree with the earlier steps' work merged in, so there
   * is one folder to try the result in. It is brought up to date again when that work changes.
   */
  async function prepareFolder(taskId: string): Promise<void> {
    const task = find(taskId);
    if (!task || task.runner !== "human" || refreshing.has(taskId) || closed()) return;
    refreshing.add(taskId);
    let first = false;
    try {
      const dir = folderFor(task);
      if ("error" in dir) {
        fail(taskId, dir.error);
        return;
      }
      const name = task.git ? task.worktree : branchName(task, state().tasks);
      if (!isTaskName(name)) {
        fail(taskId, `Not a usable step folder name: ${name}`);
        return;
      }
      dispatch({ type: "updateTask", id: taskId, patch: { worktree: name, activity: "Bringing in the earlier steps' work…" } });
      let tree: Awaited<ReturnType<typeof openWorktree>>;
      let merged: string[];
      let diff: Changes;
      try {
        [tree, merged, diff] = await serialized(dir.path, async () => {
          const repo = await ensureRepo(dir.path);
          const opened = await openWorktree(repo, worktrees, taskId, name, task.git?.branch);
          const brought = await prepareRun(opened, branches(upstreamTasks(state(), task)), await personAuthor(repo));
          return [opened, brought, await changes(opened.folder, opened.branch)] as const;
        });
      } catch (error) {
        fail(taskId, `Could not bring in the earlier steps' work: ${message(error)}`);
        return;
      }
      const latest = find(taskId);
      if (!latest || latest.status !== "queued" || closed()) return;
      if (!latest.git) {
        first = true;
        dispatch({ type: "updateTask", id: taskId, patch: { git: { branch: tree.branch, folder: tree.folder, target: tree.target, head: diff.head } } });
      }
      dispatch({ type: "refreshed", id: taskId, head: diff.head, merged, filesChanged: diff.files, previews: diff.diffs, keepReview: true });
    } finally {
      refreshing.delete(taskId);
      schedule();
    }
    if (!first) return;
    const error = await writeChecklist(taskId, false);
    if (error) console.warn(`[shepherd] Could not write the checklist for ${task.name}: ${error}`);
  }

  /**
   * Writes a person's checklist from the earlier steps' work: straight into a step that says nothing
   * yet, or as a suggestion to use or discard. Returns why it could not.
   */
  async function writeChecklist(taskId: string, suggest: boolean): Promise<string | null> {
    const task = find(taskId);
    if (!task || !options.checklist || closed() || (!suggest && !blankInstructions(task))) return null;
    if (task.drafting) return "Shepherd is already writing this step's checklist.";
    const before = task.objective;
    dispatch({ type: "updateTask", id: taskId, patch: { drafting: true } });
    try {
      const result = await options.checklist(state(), task, closing.signal);
      const latest = find(taskId);
      if (!latest || closed()) return null;
      if ("error" in result) return result.error;
      if (suggest) dispatch({ type: "updateTask", id: taskId, patch: { checklist: result.text } });
      else if (latest.objective === before) dispatch({ type: "updateTask", id: taskId, patch: { objective: result.text } });
      return null;
    } finally {
      if (find(taskId)?.drafting) dispatch({ type: "updateTask", id: taskId, patch: { drafting: undefined } });
    }
  }

  /** Commits what a person changed in their step's folder, so it is part of the result. */
  async function commitPerson(taskId: string): Promise<string | null> {
    const task = find(taskId);
    if (!task?.git || !existsSync(task.git.folder)) return null;
    const dir = folderFor(task);
    if ("error" in dir) return dir.error;
    const folder = task.git.folder;
    const branch = task.git.branch;
    let diff: Changes;
    try {
      diff = await serialized(dir.path, async () => {
        await commitAll(folder, [(task.name || "Shepherd step").slice(0, 72), "Changes made by hand"], await personAuthor(dir.path));
        return changes(folder, branch);
      });
    } catch (error) {
      return `Could not commit your changes: ${message(error)}`;
    }
    const git = find(taskId)?.git;
    if (!git) return null;
    dispatch({ type: "updateTask", id: taskId, patch: { filesChanged: diff.files, previews: diff.diffs, git: { ...git, head: diff.head } } });
    if (diff.head !== task.git.head) outdateDownstream(taskId, `${task.name} changed`);
    return null;
  }

  /** A person found a problem: tell the earlier step that owns it, and run that step again. */
  function sendBack(fromId: string, toId: string, note: string): string | null {
    const from = find(fromId);
    const to = find(toId);
    if (!from || !to) return "There is no such step.";
    if (to.runner !== "agent") return `${to.name} is done by a person. Tell them directly.`;
    if (!upstreamOf(fromId).includes(toId)) return `${to.name} is not before ${from.name}, so its fix would not reach it.`;
    if (runs.has(toId)) return `${to.name} is already running. Send it an instruction from its Log tab.`;
    const text = `${from.name || "A later step"} found a problem with this work: ${note}`;
    dispatch({ type: "instruct", id: toId, text });
    track(run(toId, text, true));
    return null;
  }

  async function check(taskId: string): Promise<void> {
    const task = find(taskId);
    const commandLine = task?.checkCommand;
    if (!task || !commandLine || checks.has(taskId) || closed()) return;
    checks.add(taskId);
    try {
      dispatch({ type: "startCheck", taskId });
      const started = Date.now();
      const directory = state().projects.find((item) => item.id === task.projectId)?.directory;
      const folder = checkFolder(state().workspace, directory, task.git?.branch, sandbox, worktrees);
      let run: CheckRun;
      try {
        if ("error" in folder) throw new Error(folder.error);
        const dir = evidenceFolder(evidence, taskId);
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          SHEPHERD_GATE: gate,
          SHEPHERD_EVIDENCE_DIR: dir,
          SHEPHERD_TASK: task.name,
          ...lookEnv(taskId),
          ...(task.git ? { SHEPHERD_BRANCH: task.git.branch, SHEPHERD_BASE_REF: `refs/shepherd-base/${task.git.branch}` } : {}),
        };
        const result = await runCheckCommand(folder.path, commandLine, options.checkTimeoutMs, env, closing.signal);
        run = { command: commandLine, ...result, steps: gateSteps(dir), artifacts: artifacts(dir) };
      } catch (error) {
        run = { command: commandLine, exitCode: null, output: message(error), durationMs: Date.now() - started };
      }
      if (closed()) return;
      dispatch({ type: "recordCheck", taskId, run });
    } finally {
      checks.delete(taskId);
      schedule();
    }
    const after = find(taskId);
    const failed = after?.verification.some((item) => item.kind === "command" && item.state === "failed");
    const automatic = after && (after.autoRun || planRunning(after.projectId));
    if (after && failed && automatic && after.runner === "agent" && after.status === "failed" && (after.retries ?? 0) < MAX_RETRIES) {
      const attempt = (after.retries ?? 0) + 1;
      dispatch({ type: "updateTask", id: taskId, patch: { retries: attempt } });
      track(run(taskId, `Shepherd's check failed, so this is automatic retry ${attempt} of ${MAX_RETRIES}. Fix the cause.`, false));
    }
  }

  async function merge(taskId: string): Promise<string | null> {
    const task = find(taskId);
    if (!task?.git) return "This task has no branch yet. Run it first.";
    if (!isFullyVerified(task)) return "Verify the task before merging it.";
    const dir = folderFor(task);
    if ("error" in dir) return dir.error;
    try {
      const done = await serialized(dir.path, () =>
        mergeBranch(realpathSync(dir.path), task.git!.branch, `Merge ${task.name} (${task.git!.branch})`),
      );
      dispatch({ type: "merged", id: taskId, into: done.into, sha: done.sha });
      return null;
    } catch (error) {
      return message(error);
    }
  }

  /** Sends one task's failed check to an upstream task that owns the cause, and runs it. */
  async function forward(fromId: string, toId: string): Promise<string | null> {
    const from = find(fromId);
    const to = find(toId);
    if (!from || !to) return "There is no such task.";
    if (to.runner !== "agent") return `${to.name} is done by a person. Tell them directly.`;
    if (!upstreamOf(fromId).includes(toId)) return `${to.name} is not upstream of ${from.name}, so its fix would not reach it.`;
    const failed = from.verification.find((item) => item.kind === "command" && item.state === "failed");
    if (!failed) return `${from.name} has no failed check to send.`;
    const steps = (failed.steps ?? []).filter((step) => !step.ok);
    const brief = `Fix what made ${from.name} fail its check${steps[0] ? `: ${steps[0].name}${steps[0].detail ? ` (${steps[0].detail})` : ""}` : ""}.`;
    const extra = [
      `${from.name} (downstream of this task) failed its check, and the cause is in this task's part of the work. Fix it here; do not work around it.`,
      `Its check: ${failed.command ?? from.checkCommand ?? ""}`,
      steps.length ? ["Failed steps:", ...steps.map((step) => `- ${step.name}${step.detail ? `: ${step.detail}` : ""}`)].join("\n") : "",
      "The end of its output:",
      "```",
      (failed.output ?? "").slice(-2500).trim() || "(no output)",
      "```",
      "Shepherd checks this task again, then brings your fix into the tasks downstream and checks them again.",
    ]
      .filter(Boolean)
      .join("\n");
    dispatch({ type: "instruct", id: toId, text: brief });
    track(run(toId, extra, true));
    return null;
  }

  function upstreamOf(taskId: string): string[] {
    const { dependencies } = state();
    const seen = new Set<string>();
    for (let queue = [taskId]; queue.length; ) {
      const next = queue.shift()!;
      for (const dep of dependencies) {
        if (dep.target !== next || seen.has(dep.source)) continue;
        seen.add(dep.source);
        queue.push(dep.source);
      }
    }
    return [...seen];
  }

  function schedule() {
    if (closed()) return;
    tick ??= setTimeout(() => {
      tick = null;
      try {
        startReady();
      } catch (error) {
        console.error("[shepherd] scheduler", error);
      }
    }, 0);
  }

  function planRunning(projectId: string): boolean {
    return !!state().projects.find((project) => project.id === projectId)?.running;
  }

  /**
   * Checks finished work whose check never ran to the end, such as one a restart cut short,
   * refreshes out-of-date tasks, and starts steps once the steps before them are done: every
   * waiting step of a running plan, and fresh steps set to start by themselves. A plan stops
   * running once every step in it is done.
   */
  function startReady() {
    const { tasks, dependencies, projects } = state();
    const planned = new Set(projects.filter((project) => project.running).map((project) => project.id));
    let started = [...runs.values()].filter((attempt) => attempt.scheduled).length;
    for (const task of tasks) {
      if (runs.has(task.id) || checks.has(task.id) || refreshing.has(task.id)) continue;
      if (task.status === "completed" && !task.outdated && task.checkCommand && uncheckedCommand(task)) {
        track(check(task.id));
        continue;
      }
      if (task.status !== "queued" || unmetDependencies(task.id, tasks, dependencies).length) continue;
      if (task.runner === "human") {
        const due = task.outdated || (!task.git && upstreamTasks(state(), task).some((item) => item.git));
        if (due) track(prepareFolder(task.id));
        continue;
      }
      if (task.outdated) {
        track(refresh(task.id));
        continue;
      }
      const fresh = !task.git && !task.sessionId;
      const wanted = planned.has(task.projectId) || (task.autoRun && fresh);
      if (!wanted || !task.agentId || started >= MAX_PARALLEL_RUNS) continue;
      started += 1;
      track(run(task.id, undefined, false));
    }
    for (const projectId of planned) {
      const steps = tasks.filter((task) => task.projectId === projectId);
      if (steps.length && !steps.every(isFullyVerified)) continue;
      dispatch({ type: "setPlanRunning", projectId, running: false });
    }
  }

  /** Runs every step of a project that is not done yet, each as soon as the steps before it are done. */
  function runPlan(projectId: string): string | null {
    const steps = state().tasks.filter((task) => task.projectId === projectId);
    if (!steps.length) return "Add a step first.";
    const todo = steps.filter((task) => !isFullyVerified(task));
    if (!todo.length) return "Every step is already done.";
    const nobody = todo.find((task) => task.runner === "agent" && !task.agentId);
    if (nobody) return `Pick who does ${nobody.name || "the unnamed step"} first.`;
    const unnamed = todo.find((task) => !task.name.trim() && !task.objective.trim());
    if (unnamed) return "One step has no name or prompt yet. Give it one or delete it.";
    dispatch({ type: "setPlanRunning", projectId, running: true });
    const { tasks, dependencies } = state();
    for (const task of todo) {
      if (task.runner !== "agent" || runs.has(task.id) || unmetDependencies(task.id, tasks, dependencies).length) continue;
      const paused = task.status === "blocked" && task.blocker === "Paused by you";
      if (task.status === "failed" || paused) track(run(task.id, undefined, true));
    }
    schedule();
    return null;
  }

  /** Stops a running plan: its agents are paused where they are, and nothing new starts. */
  function stopPlan(projectId: string) {
    dispatch({ type: "setPlanRunning", projectId, running: false });
    for (const task of state().tasks) {
      if (task.projectId !== projectId || !runs.has(task.id)) continue;
      kill(task.id);
      dispatch({ type: "setStatus", id: task.id, status: "blocked" });
    }
  }

  /**
   * Merges every finished step's branch into the project folder's branch. The last steps go first:
   * their branches already hold the work of the steps before them, so those need no merge of their own.
   */
  async function mergePlan(projectId: string): Promise<string | null> {
    const { tasks, dependencies } = state();
    const steps = tasks.filter((task) => task.projectId === projectId);
    const waiting = steps.filter((task) => !isFullyVerified(task));
    if (waiting.length) return `${waiting[0]!.name || "A step"} is not done yet.`;
    const open = dependencyOrder(steps, dependencies)
      .filter((task) => task.git && !task.git.merged)
      .reverse();
    if (!open.length) return "There is nothing left to merge.";
    for (const task of open) {
      const error = await merge(task.id);
      if (error) return `${task.name}: ${error}`;
    }
    return null;
  }

  async function handle(body: unknown): Promise<{ ok: true } | { error: string }> {
    const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const outcome = (error: string | null) => (error ? { error } : ({ ok: true } as const));
    if (raw.command === "runPlan" || raw.command === "stopPlan" || raw.command === "mergePlan") {
      const projectId = typeof raw.projectId === "string" ? raw.projectId : "";
      if (!state().projects.some((project) => project.id === projectId)) {
        return { error: projectId ? `There is no project ${projectId}.` : "Say which project, as projectId." };
      }
      if (closed()) return { error: "Shepherd is restarting. Try again in a moment." };
      if (raw.command === "runPlan") return outcome(runPlan(projectId));
      if (raw.command === "stopPlan") {
        stopPlan(projectId);
        return { ok: true };
      }
      return outcome(await mergePlan(projectId));
    }
    const taskId = typeof raw.taskId === "string" ? raw.taskId : "";
    const task = find(taskId);
    if (!task) return { error: taskId ? `There is no task ${taskId}.` : "Say which task, as taskId." };
    switch (raw.command) {
      case "run": {
        if (task.runner === "human") {
          if (task.status !== "failed") return { error: "A person does this task. Mark it complete when it is done." };
          dispatch({ type: "setStatus", id: taskId, status: "queued" });
          track(prepareFolder(taskId));
          return { ok: true };
        }
        track(run(taskId, typeof raw.extra === "string" ? raw.extra : undefined, true));
        return { ok: true };
      }
      case "stop": {
        kill(taskId);
        dispatch({ type: "setStatus", id: taskId, status: raw.status === "queued" ? "queued" : "blocked" });
        return { ok: true };
      }
      case "instruct": {
        const text = typeof raw.text === "string" ? raw.text.trim() : "";
        if (!text) return { error: "Send the instruction as text." };
        dispatch({ type: "instruct", id: taskId, text });
        const latest = find(taskId)!;
        if (latest.runner === "human" || !latest.sessionId) return { ok: true };
        if (runs.has(taskId)) {
          dispatch({ type: "updateTask", id: taskId, patch: { activity: "Instruction saved for the next run" } });
          return { ok: true };
        }
        track(run(taskId, text, true));
        return { ok: true };
      }
      case "check":
        if (!task.checkCommand) return { error: `${task.name} has no check command.` };
        track(check(taskId));
        return { ok: true };
      case "complete": {
        if (task.runner !== "human") return { error: "Agent tasks complete when their run finishes." };
        if (refreshing.has(taskId) || task.outdated) return { error: "Shepherd is still bringing in the earlier steps' work. Try again in a moment." };
        const unmet = unmetDependencies(taskId, state().tasks, state().dependencies);
        if (!unmet.length) {
          const error = await commitPerson(taskId);
          if (error) return { error };
        }
        dispatch({ type: "setStatus", id: taskId, status: "completed" });
        const latest = find(taskId);
        if (latest?.status !== "completed") return { error: latest?.blocker ?? `${task.name} cannot be completed yet.` };
        if (latest.checkCommand) track(check(taskId));
        return { ok: true };
      }
      case "merge":
        return outcome(await merge(taskId));
      case "forward":
        return outcome(await forward(taskId, typeof raw.to === "string" ? raw.to : ""));
      case "sendBack": {
        const note = typeof raw.text === "string" ? raw.text.trim() : "";
        if (!note) return { error: "Say what is wrong, as text." };
        return outcome(sendBack(taskId, typeof raw.to === "string" ? raw.to : "", note));
      }
      case "checklist": {
        if (task.runner !== "human") return { error: `An agent does ${task.name}, so its prompt is yours to write.` };
        if (!options.checklist) return { error: "This Shepherd cannot write checklists." };
        const work = writeChecklist(taskId, true);
        track(work);
        return outcome(await work);
      }
      default:
        return {
          error: "command must be run, stop, instruct, check, complete, merge, forward, sendBack, checklist, runPlan, stopPlan or mergePlan.",
        };
    }
  }

  engine.subscribe(schedule);
  schedule();

  return {
    handle,
    cancel: kill,
    cancelAll() {
      for (const id of [...runs.keys()]) kill(id);
    },
    close() {
      closing.abort();
      if (tick) clearTimeout(tick);
      tick = null;
      for (const id of [...runs.keys()]) kill(id);
    },
    schedule,
    async idle() {
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (!tick && !work.size) return;
        await Promise.allSettled([...work]);
      }
    },
  };
}

/** A folder and branch name made from the step's name, unique among its project's steps. */
export function branchName(task: Task, tasks: Task[]): string {
  const taken = new Set(tasks.filter((item) => item.projectId === task.projectId && item.id !== task.id).map((item) => item.worktree));
  const base = slugify(task.name, "step");
  let candidate = base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${base}-${n}`;
  return candidate;
}

function branches(tasks: Task[]): string[] {
  return tasks.flatMap((task) => (task.git ? [task.git.branch] : []));
}

/** The review still holds when the task's own changes are exactly what the reviewer saw. */
function sameDiff(task: Task, diff: Changes): boolean {
  if (task.filesChanged.join("\n") !== diff.files.join("\n")) return false;
  const seen = new Map(task.previews.map((item) => [item.path, item.text]));
  return diff.diffs.length === task.previews.length && diff.diffs.every((item) => seen.get(item.path) === item.text);
}

export function providerFor(task: Task): AgentCli {
  return agentById(task.agentId)?.provider === "claude-code" ? "claude" : "codex";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  try {
    if (child.pid) process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

/** A step whose prompt is empty or only repeats its name. */
export function blankInstructions(task: Task): boolean {
  const text = task.objective.trim();
  return !text || text === task.name.trim();
}

function uncheckedCommand(task: Task): boolean {
  return task.verification.some((check) => check.kind === "command" && check.state === "pending" && !check.running);
}

export function projectFolder(workspace: string | undefined, directory: string | undefined, sandbox: string): { path: string } | { error: string } {
  if (!directory?.trim()) return { error: "This project has no folder." };
  const root = resolveWorkspace(workspace, sandbox);
  if ("error" in root) return root;
  const dir = inside(root.path, directory);
  return dir ? { path: dir } : { error: "The project folder must stay inside the workspace." };
}

/** A task with a branch is checked in its worktree; anything else is checked in the project folder. */
export function checkFolder(
  workspace: string | undefined,
  directory: string | undefined,
  branch: string | undefined,
  sandbox: string,
  worktrees: string,
): { path: string } | { error: string } {
  const dir = projectFolder(workspace, directory, sandbox);
  if ("error" in dir || !branch) {
    if (!("error" in dir)) mkdirSync(dir.path, { recursive: true });
    return dir;
  }
  if (!isTaskBranch(branch)) return { error: `Not a Shepherd branch: ${branch}` };
  let folder: string;
  try {
    folder = worktreeFolder(worktrees, realpathSync(dir.path), branch);
  } catch {
    return { error: `The project folder ${dir.path} does not exist.` };
  }
  return existsSync(folder) ? { path: folder } : { error: `The worktree for ${branch} is missing. Run the task again to recreate it.` };
}

const SAFE_ID = /^[\w.-]{1,120}$/;

export function evidenceFolder(root: string, taskId: string): string {
  if (!SAFE_ID.test(taskId)) throw new Error(`Not a usable task id: ${taskId}`);
  const dir = path.join(root, taskId);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The steps a gate script wrote to gate.json in the evidence folder. */
export function gateSteps(dir: string): GateStep[] | undefined {
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, "gate.json"), "utf8")) as { steps?: unknown };
    if (!Array.isArray(raw.steps)) return undefined;
    return raw.steps.flatMap((item) => {
      const step = item as Record<string, unknown>;
      if (typeof step?.name !== "string" || typeof step.ok !== "boolean") return [];
      const detail = typeof step.detail === "string" && step.detail ? step.detail.slice(0, 500) : undefined;
      return [{ name: step.name.slice(0, 120), ok: step.ok, ...(detail ? { detail } : {}) }];
    });
  } catch {
    return undefined;
  }
}

const ARTIFACT_LIMIT = 60;
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const SKIP = /\.(css|js|mjs|map|svg|ico|woff2?|ttf)$/i;

/**
 * The files worth opening from a check's evidence: screenshots, report entry pages, traces and
 * logs. Report internals (assets, per-file coverage pages) are left out.
 */
export function artifacts(dir: string): string[] | undefined {
  const found: string[] = [];
  const walk = (relative: string, depth: number) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(path.join(dir, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== "data" && entry.name !== "node_modules" && depth < 4) walk(file, depth + 1);
        continue;
      }
      if (SKIP.test(entry.name) || file === "gate.json") continue;
      const report = entry.name === "index.html";
      const shallow = depth === 0 && !/\.html$/i.test(entry.name);
      if (IMAGE.test(entry.name) || report || shallow || entry.name === "trace.zip") found.push(file);
    }
  };
  walk("", 0);
  found.sort((a, b) => Number(IMAGE.test(b)) - Number(IMAGE.test(a)) || a.localeCompare(b));
  return found.length ? found.slice(0, ARTIFACT_LIMIT) : undefined;
}

const CHECK_OUTPUT_LIMIT = 64_000;

export function runCheckCommand(
  dir: string,
  command: string,
  timeoutMs = 300_000,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<{ exitCode: number | null; output: string; durationMs: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = "";
    let timedOut = false;
    // Its own process group, so stopping it also stops the servers and browsers it started.
    const child = spawn("/bin/sh", ["-c", command], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-CHECK_OUTPUT_LIMIT);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const stop = () => {
      killGroup(child);
      setTimeout(() => killGroup(child, "SIGKILL"), 2000).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    signal?.addEventListener("abort", stop, { once: true });
    let settled = false;
    const done = (exitCode: number | null, extra = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      resolve({ exitCode: timedOut ? null : exitCode, output: output + extra, durationMs: Date.now() - started, timedOut });
    };
    if (signal?.aborted) stop();
    child.on("error", (error) => done(null, `\n${error.message}`));
    child.on("close", (code) => done(code));
  });
}

/** Timestamped tracing output from the CLI itself, such as Codex failing to reach one of its MCP servers. */
const LOG_LINE = /^\d{4}-\d{2}-\d{2}T\S+\s+(TRACE|DEBUG|INFO|WARN|ERROR)\b/;

export function withoutLogLines(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !LOG_LINE.test(line))
    .join("\n");
}

export function exitError(stderr: string): string | undefined {
  const lines = stderr.split("\n").map((line) => line.trim()).filter(Boolean);
  const own = lines.filter((line) => !LOG_LINE.test(line));
  const line = own.find((item) => /^error\b/i.test(item)) ?? own.at(-1) ?? lines.at(-1);
  return line?.slice(0, 240);
}

export function inside(base: string, relative: string | undefined): string | null {
  const trimmed = relative?.trim() ?? "";
  if (!trimmed) return base;
  if (path.isAbsolute(trimmed)) return null;
  const resolved = path.resolve(base, trimmed);
  return resolved === base || resolved.startsWith(base + path.sep) ? resolved : null;
}

function resolveWorkspace(requested: string | undefined, sandbox: string): { path: string } | { error: string } {
  const resolved = path.resolve(requested?.trim() || sandbox);
  try {
    if (!statSync(resolved).isDirectory()) return { error: `${resolved} is not a directory.` };
  } catch {
    return { error: `Workspace does not exist: ${resolved}` };
  }
  return { path: resolved };
}

export function agentCommand(
  provider: AgentCli,
  prompt: string,
  resumeId: string | null,
  choice: Pick<Task, "model" | "effort"> = {},
): { cmd: string; args: string[] } {
  const model = isModelId(choice.model) ? choice.model : null;
  const effort = isEffort(choice.effort) ? choice.effort : null;
  if (provider === "codex") {
    // Without network the sandbox cannot install packages; agents install, build and test like a developer would.
    const shared = [
      ...(model ? ["-m", model] : []),
      ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
      "--json",
      "--skip-git-repo-check",
      "-c",
      "sandbox_workspace_write.network_access=true",
    ];
    if (resumeId) {
      // `codex exec resume` has no --sandbox flag; the config override is equivalent.
      return {
        cmd: "codex",
        args: ["exec", "resume", resumeId, ...shared, "-c", 'sandbox_mode="workspace-write"', prompt],
      };
    }
    return { cmd: "codex", args: ["exec", ...shared, "--sandbox", "workspace-write", prompt] };
  }
  const args = ["-p", "--verbose", "--output-format", "stream-json", "--permission-mode", "acceptEdits"];
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (resumeId) args.push("--resume", resumeId);
  args.push(prompt);
  return { cmd: "claude", args };
}

/** Codex's sandbox can only write to the worktree and the temp folder, so npm's cache moves to the temp folder. */
export function agentEnv(provider: AgentCli, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (provider !== "codex") return env;
  const next = Object.fromEntries(Object.entries(env).filter(([key]) => key.toLowerCase() !== "npm_config_cache"));
  return { ...next, npm_config_cache: path.join(tmpdir(), "shepherd-npm-cache") };
}

export function agentStatus(): Promise<{ claude: boolean; codex: boolean }> {
  return Promise.all([loginStatus("claude"), loginStatus("codex")]).then(([claude, codex]) => ({ claude, codex }));
}

function loginStatus(provider: AgentCli): Promise<boolean> {
  return provider === "claude"
    ? commandSucceeds("claude", ["auth", "status"], (text) => /"loggedIn"\s*:\s*true/.test(text))
    : commandSucceeds("codex", ["login", "status"], (text) => /Logged in/.test(text));
}

/** Asking the CLI takes a moment, so a yes is trusted for a minute. A no is asked again every time. */
function cachedLogin(): (provider: AgentCli) => Promise<boolean> {
  const seen = new Map<AgentCli, number>();
  return async (provider) => {
    const at = seen.get(provider);
    if (at && Date.now() - at < 60_000) return true;
    const ok = await loginStatus(provider);
    if (ok) seen.set(provider, Date.now());
    else seen.delete(provider);
    return ok;
  };
}

function commandSucceeds(cmd: string, args: string[], accept: (text: string) => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: process.env });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(false);
    }, 8000);
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(accept(output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")));
    });
  });
}

