import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { loadState } from "../src/model/migrate";
import type { OrchestrationState } from "../src/model/types";
import { CODEX_MODEL, isDemoState, workspace } from "../src/model/workspace";
import { boardSummary, createInbox } from "./intake";
import { parseAgentLine } from "../src/runner/parse";
import {
  changes,
  commitAll,
  ensureRepo,
  gitAvailable,
  isTaskBranch,
  isTaskName,
  mergeBranch,
  openWorktree,
  prepareRun,
  serialized,
  worktreeFolder,
  type Author,
  type Worktree,
} from "./git";

type AgentCli = "claude" | "codex";

interface RunBody {
  taskId?: string;
  name?: string;
  workspace?: string;
  directory?: string;
  worktree?: string;
  branch?: string;
  upstream?: string[];
  prompt?: string;
  resumeId?: string | null;
  provider?: string;
}

interface ActiveRun {
  child: ChildProcess;
  stopped: boolean;
}

const runs = new Map<string, ActiveRun>();

const AUTHORS: Record<AgentCli, Author> = {
  codex: { name: "Codex", email: "codex@shepherd.local" },
  claude: { name: "Claude Code", email: "claude-code@shepherd.local" },
};

export function shepherdApi(): Plugin {
  const sandbox = path.resolve(process.cwd(), ".agent-sandbox");
  const worktrees = path.resolve(process.cwd(), ".shepherd/worktrees");
  const stateFile = path.resolve(process.cwd(), ".shepherd/state.json");
  const inbox = createInbox(path.resolve(process.cwd(), ".shepherd/inbox.json"), (state) =>
    writeSharedState(stateFile, { state: { state }, version: 2 }),
  );
  return {
    name: "shepherd-api",
    configureServer(server) {
      mkdirSync(sandbox, { recursive: true });
      mkdirSync(path.dirname(stateFile), { recursive: true });
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://shepherd.local");
        if (url.pathname === "/api/state") {
          if (req.method === "GET") {
            sendJson(res, 200, readSharedState(stateFile));
            return;
          }
          if (req.method === "PUT") {
            const body = await readJson(req);
            writeSharedState(stateFile, body);
            inbox.saved(body);
            sendJson(res, 200, { ok: true });
            return;
          }
          if (req.method === "DELETE") {
            writeSharedState(stateFile, { state: { state: workspace() }, version: 2 });
            sendJson(res, 200, { ok: true });
            return;
          }
        }
        if (url.pathname === "/api/tasks" && (req.method === "GET" || req.method === "POST")) {
          const board = savedBoard(stateFile);
          if ("error" in board) {
            sendJson(res, 409, { error: board.error });
            return;
          }
          if (req.method === "GET") {
            const { state, pending } = inbox.flushOrPreview(board.state);
            sendJson(res, 200, boardSummary(state, pending));
            return;
          }
          const result = inbox.add(board.state, await readJson(req));
          sendJson(res, "error" in result ? 400 : result.applied ? 201 : 202, result);
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/inbox") {
          sendJson(res, 200, { batches: inbox.poll() });
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/agents") {
          const [status, git] = await Promise.all([agentStatus(), gitAvailable()]);
          sendJson(res, 200, { ...status, git, workspace: sandbox });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/checks") {
          const body = (await readJson(req)) as { workspace?: string; directory?: string; branch?: string; command?: string };
          const command = body.command?.trim() ?? "";
          const folder = checkFolder(body, sandbox, worktrees);
          if (!command || "error" in folder) {
            sendJson(res, 400, { error: command ? (folder as { error: string }).error : "No command to run." });
            return;
          }
          sendJson(res, 200, await runCheckCommand(folder.path, command));
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/merge") {
          const body = (await readJson(req)) as { workspace?: string; directory?: string; branch?: string; name?: string };
          const dir = projectFolder(body, sandbox);
          const branch = body.branch ?? "";
          if ("error" in dir || !isTaskBranch(branch)) {
            sendJson(res, 400, { error: "error" in dir ? dir.error : "This task has no branch to merge." });
            return;
          }
          try {
            const merged = await serialized(dir.path, () =>
              mergeBranch(realpathSync(dir.path), branch, `Merge ${body.name?.trim() || branch} (${branch})`),
            );
            sendJson(res, 200, merged);
          } catch (error) {
            sendJson(res, 409, { error: message(error) });
          }
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/runs/cancel") {
          const body = (await readJson(req)) as RunBody;
          const taskId = body.taskId ?? "";
          const run = runs.get(taskId);
          if (run) {
            run.stopped = true;
            run.child.kill("SIGTERM");
            runs.delete(taskId);
          }
          sendJson(res, 200, { ok: true, stopped: Boolean(run) });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/runs") {
          const body = (await readJson(req)) as RunBody;
          await startRun(res, body, sandbox, worktrees);
          return;
        }
        next();
      });
    },
  };
}

async function startRun(res: import("node:http").ServerResponse, body: RunBody, sandbox: string, worktrees: string) {
  const taskId = body.taskId?.trim();
  const prompt = body.prompt?.trim();
  if (!taskId || !prompt) {
    sendJson(res, 400, { ok: false, error: "A task id and prompt are required." });
    return;
  }
  const dir = projectFolder(body, sandbox);
  const name = body.worktree?.trim() ?? "";
  if ("error" in dir || !isTaskName(name)) {
    sendJson(res, 400, { ok: false, error: "error" in dir ? dir.error : `Not a usable task folder name: ${name}` });
    return;
  }
  const existing = runs.get(taskId);
  if (existing) {
    existing.stopped = true;
    existing.child.kill("SIGTERM");
  }

  res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" });
  const write = (event: Record<string, unknown>) => {
    res.write(`${JSON.stringify(event)}\n`);
  };
  const provider: AgentCli = body.provider === "codex" ? "codex" : "claude";
  const status = await agentStatus();
  if ((provider === "claude" && !status.claude) || (provider === "codex" && !status.codex)) {
    res.end(`${JSON.stringify({ kind: "error", error: `${AUTHORS[provider].name} is not logged in.` })}\n`);
    return;
  }

  const author = AUTHORS[provider];
  let tree: Worktree;
  let merged: string[];
  try {
    [tree, merged] = await serialized(dir.path, async () => {
      const repo = await ensureRepo(dir.path);
      const opened = await openWorktree(repo, worktrees, taskId, name, body.branch);
      return [opened, await prepareRun(opened, body.upstream ?? [], author)] as const;
    });
  } catch (error) {
    res.end(`${JSON.stringify({ kind: "error", error: message(error) })}\n`);
    return;
  }

  const command = agentCommand(provider, prompt, body.resumeId ?? null);
  const child = spawn(command.cmd, command.args, {
    cwd: tree.folder,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin?.end();
  const run: ActiveRun = { child, stopped: false };
  runs.set(taskId, run);
  write({ kind: "started", branch: tree.branch, folder: tree.folder, target: tree.target });
  if (merged.length) write({ kind: "activity", text: `Merged ${merged.join(", ")} into ${tree.branch}` });

  let buffer = "";
  let lastActivity = "";
  let summary = "";
  const consume = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const parsed = parseAgentLine(line);
      if (!parsed) continue;
      if (parsed.chatId) write({ kind: "chat", id: parsed.chatId });
      if (parsed.activity && parsed.activity !== lastActivity) {
        lastActivity = parsed.activity;
        write({ kind: "activity", text: parsed.activity });
      }
      if (parsed.done) {
        summary = parsed.summary && parsed.summary !== "Codex finished" ? parsed.summary : lastActivity || parsed.summary || "";
        write({ kind: "result", ok: parsed.ok !== false, summary });
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
    if (notice) write({ kind: "activity", text: notice.slice(0, 240) });
  });
  child.on("error", (error) => {
    write({ kind: "error", error: error.message });
  });
  child.on("close", async (code) => {
    if (runs.get(taskId) === run) runs.delete(taskId);
    if (buffer.trim()) consume(Buffer.from("\n"));
    // A stopped run's changes stay uncommitted; the next run commits them before it starts.
    if (run.stopped) {
      res.end();
      return;
    }
    const error = code === 0 ? undefined : exitError(stderrTail);
    try {
      const diff = await serialized(dir.path, async () => {
        await commitAll(tree.folder, [(body.name?.trim() || name).slice(0, 72), summary.slice(0, 2000)], author);
        return changes(tree.folder, tree.branch);
      });
      const files = diff.files.length
        ? `${diff.files.length} ${diff.files.length === 1 ? "file" : "files"} changed on ${tree.branch}`
        : "No files changed";
      write({ kind: "exit", code: code ?? 1, files, changed: diff.files, opened: diff.diffs, head: diff.head, error });
    } catch (commitError) {
      write({ kind: "error", error: `Could not commit the run: ${message(commitError)}` });
      write({ kind: "exit", code: code ?? 1 });
    }
    res.end();
  });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectFolder(body: { workspace?: string; directory?: string }, sandbox: string): { path: string } | { error: string } {
  if (!body.directory?.trim()) return { error: "This project has no folder." };
  const workspace = resolveWorkspace(body.workspace, sandbox);
  if ("error" in workspace) return workspace;
  const dir = inside(workspace.path, body.directory);
  return dir ? { path: dir } : { error: "The project folder must stay inside the workspace." };
}

/** A task with a branch is checked in its worktree; anything else is checked in the project folder. */
function checkFolder(
  body: { workspace?: string; directory?: string; branch?: string },
  sandbox: string,
  worktrees: string,
): { path: string } | { error: string } {
  const dir = projectFolder(body, sandbox);
  if ("error" in dir || !body.branch) {
    if (!("error" in dir)) mkdirSync(dir.path, { recursive: true });
    return dir;
  }
  if (!isTaskBranch(body.branch)) return { error: `Not a Shepherd branch: ${body.branch}` };
  let folder: string;
  try {
    folder = worktreeFolder(worktrees, realpathSync(dir.path), body.branch);
  } catch {
    return { error: `The project folder ${dir.path} does not exist.` };
  }
  return existsSync(folder) ? { path: folder } : { error: `The worktree for ${body.branch} is missing. Run the task again to recreate it.` };
}

const CHECK_OUTPUT_LIMIT = 64_000;

export function runCheckCommand(
  dir: string,
  command: string,
  timeoutMs = 120_000,
): Promise<{ exitCode: number | null; output: string; durationMs: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = "";
    let timedOut = false;
    const child = spawn("/bin/sh", ["-c", command], { cwd: dir, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-CHECK_OUTPUT_LIMIT);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, timeoutMs);
    const done = (exitCode: number | null, extra = "") => {
      clearTimeout(timer);
      resolve({ exitCode: timedOut ? null : exitCode, output: output + extra, durationMs: Date.now() - started, timedOut });
    };
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
  const raw = requested?.trim() || sandbox;
  const resolved = path.resolve(raw);
  try {
    if (!statSync(resolved).isDirectory()) return { error: `${resolved} is not a directory.` };
  } catch {
    return { error: `Workspace does not exist: ${resolved}` };
  }
  return { path: resolved };
}

export function agentCommand(provider: AgentCli, prompt: string, resumeId: string | null): { cmd: string; args: string[] } {
  if (provider === "codex") {
    const shared = ["-m", CODEX_MODEL, "--json", "--skip-git-repo-check"];
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
  if (resumeId) args.push("--resume", resumeId);
  args.push(prompt);
  return { cmd: "claude", args };
}

function agentStatus(): Promise<{ claude: boolean; codex: boolean }> {
  return Promise.all([
    commandSucceeds("claude", ["auth", "status"], (text) => /"loggedIn"\s*:\s*true/.test(text)),
    commandSucceeds("codex", ["login", "status"], (text) => /Logged in/.test(text)),
  ]).then(([claude, codex]) => ({ claude, codex }));
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

function savedBoard(file: string): { state: OrchestrationState } | { error: string } {
  if (!existsSync(file)) return { state: workspace() };
  const body = readSharedState(file) as { state?: { state?: unknown } } | null;
  const state = loadState(body?.state?.state);
  return state ? { state } : { error: `Shepherd cannot read the saved board in ${file}, so it will not add tasks to it.` };
}

function readSharedState(file: string): unknown {
  try {
    return sanitizeSharedState(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return { state: null, version: 2 };
  }
}

function writeSharedState(file: string, body: unknown) {
  const clean = sanitizeSharedState(body);
  mkdirSync(path.dirname(file), { recursive: true });
  backupSharedState(file, clean);
  writeFileSync(file, JSON.stringify(clean));
}

const BACKUP_LIMIT = 30;
let lastBackupAt = 0;

function taskCount(body: unknown): number {
  const tasks = (body as { state?: { state?: { tasks?: unknown } } } | null)?.state?.state?.tasks;
  return Array.isArray(tasks) ? tasks.length : 0;
}

function backupSharedState(file: string, next: unknown) {
  let previous: unknown;
  try {
    previous = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return;
  }
  const shrinking = taskCount(next) < taskCount(previous);
  if (!shrinking && Date.now() - lastBackupAt < 60_000) return;
  lastBackupAt = Date.now();
  const dir = path.join(path.dirname(file), "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(path.join(dir, `state-${stamp}.json`), JSON.stringify(previous));
  const stale = readdirSync(dir)
    .filter((name) => name.startsWith("state-"))
    .sort()
    .slice(0, -BACKUP_LIMIT);
  for (const name of stale) rmSync(path.join(dir, name));
}

function sanitizeSharedState(body: unknown): unknown {
  const record = body as { state?: { state?: unknown }; version?: number } | null;
  const saved = record?.state?.state;
  if (isDemoState(saved)) {
    return { state: { state: workspace() }, version: 2 };
  }
  return body;
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}
