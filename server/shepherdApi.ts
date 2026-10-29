import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { CODEX_MODEL, isDemoState, workspace } from "../src/model/workspace";
import { parseAgentLine } from "../src/runner/parse";
import { changedPaths, type FileStamp } from "../src/runner/snapshot";

type AgentCli = "claude" | "codex";

interface RunBody {
  taskId?: string;
  workspace?: string;
  directory?: string;
  worktree?: string;
  prompt?: string;
  resumeId?: string | null;
  provider?: string;
}

interface ActiveRun {
  child: ChildProcess;
  dir: string;
  shared: boolean;
}

const runs = new Map<string, ActiveRun>();

export function shepherdApi(): Plugin {
  const sandbox = path.resolve(process.cwd(), ".agent-sandbox");
  const stateFile = path.resolve(process.cwd(), ".shepherd/state.json");
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
            sendJson(res, 200, { ok: true });
            return;
          }
          if (req.method === "DELETE") {
            writeSharedState(stateFile, { state: { state: workspace() }, version: 2 });
            sendJson(res, 200, { ok: true });
            return;
          }
        }
        if (req.method === "GET" && url.pathname === "/api/agents") {
          const status = await agentStatus();
          sendJson(res, 200, { ...status, workspace: sandbox });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/checks") {
          const body = (await readJson(req)) as { workspace?: string; directory?: string; command?: string };
          const command = body.command?.trim() ?? "";
          const workspace = resolveWorkspace(body.workspace, sandbox);
          if ("error" in workspace) {
            sendJson(res, 400, { error: workspace.error });
            return;
          }
          const dir = inside(workspace.path, body.directory);
          if (!command || !dir) {
            sendJson(res, 400, { error: command ? "The project folder must stay inside the workspace." : "No command to run." });
            return;
          }
          mkdirSync(dir, { recursive: true });
          sendJson(res, 200, await runCheckCommand(dir, command));
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/runs/cancel") {
          const body = (await readJson(req)) as RunBody;
          const taskId = body.taskId ?? "";
          const run = runs.get(taskId);
          if (run) {
            run.child.kill("SIGTERM");
            runs.delete(taskId);
          }
          sendJson(res, 200, { ok: true, stopped: Boolean(run) });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/runs") {
          const body = (await readJson(req)) as RunBody;
          await startRun(res, body, sandbox);
          return;
        }
        next();
      });
    },
  };
}

async function startRun(res: import("node:http").ServerResponse, body: RunBody, sandbox: string) {
  const taskId = body.taskId?.trim();
  const prompt = body.prompt?.trim();
  if (!taskId || !prompt) {
    sendJson(res, 400, { ok: false, error: "A task id and prompt are required." });
    return;
  }
  const workspace = resolveWorkspace(body.workspace, sandbox);
  if ("error" in workspace) {
    sendJson(res, 400, { ok: false, error: workspace.error });
    return;
  }
  const dir = inside(workspace.path, body.directory);
  const worktree = body.worktree?.trim().replace(/^\/+|\/+$/g, "") ?? "";
  const own = dir && worktree ? inside(dir, worktree) : dir;
  if (!dir || !own) {
    sendJson(res, 400, { ok: false, error: "The project folder and task folder must stay inside the workspace." });
    return;
  }
  mkdirSync(own, { recursive: true });
  const existing = runs.get(taskId);
  if (existing) existing.child.kill("SIGTERM");

  const provider: AgentCli = body.provider === "codex" ? "codex" : "claude";
  const status = await agentStatus();
  if ((provider === "claude" && !status.claude) || (provider === "codex" && !status.codex)) {
    const name = provider === "codex" ? "Codex" : "Claude Code";
    res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache" });
    res.end(`${JSON.stringify({ kind: "error", error: `${name} is not logged in.` })}\n`);
    return;
  }

  const command = agentCommand(provider, prompt, body.resumeId ?? null);
  const before = listFiles(dir);
  const child = spawn(command.cmd, command.args, {
    cwd: dir,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin?.end();
  const run: ActiveRun = { child, dir, shared: false };
  for (const [otherId, other] of runs) {
    if (otherId === taskId || !overlaps(other.dir, dir)) continue;
    other.shared = true;
    run.shared = true;
  }
  runs.set(taskId, run);

  res.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-cache",
  });
  const write = (event: Record<string, unknown>) => {
    res.write(`${JSON.stringify(event)}\n`);
  };
  write({ kind: "started", workspace: dir });

  let buffer = "";
  let lastActivity = "";
  const consume = (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const parsed = parseAgentLine(line);
      if (!parsed) continue;
      if (parsed.chatId) write({ kind: "chat", id: parsed.chatId });
      if (parsed.activity) {
        lastActivity = parsed.activity;
        write({ kind: "activity", text: parsed.activity });
      }
      if (parsed.done) {
        const summary = parsed.summary && parsed.summary !== "Codex finished" ? parsed.summary : lastActivity || parsed.summary;
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
    write({ kind: "activity", text: text.slice(0, 240) });
  });
  child.on("error", (error) => {
    write({ kind: "error", error: error.message });
  });
  child.on("close", (code) => {
    if (runs.get(taskId) === run) runs.delete(taskId);
    if (buffer.trim()) consume(Buffer.from("\n"));
    const all = changedPaths(before, listFiles(dir));
    const mine = worktree ? all.filter((file) => file.startsWith(`${worktree}/`)) : all;
    const changed = (run.shared ? mine : all).slice(0, 40);
    const files = changed.length ? `Wrote ${changed.join(", ")}` : "No files changed";
    const opened = changed.flatMap((file) => {
      const text = readTextPreview(dir, file);
      return text == null ? [] : [{ path: file, text }];
    });
    const error = code === 0 ? undefined : exitError(stderrTail);
    write({ kind: "exit", code: code ?? 1, files, changed, opened, error });
    res.end();
  });
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

export function exitError(stderr: string): string | undefined {
  const lines = stderr.split("\n").map((line) => line.trim()).filter(Boolean);
  const line = lines.find((item) => /^error\b/i.test(item)) ?? lines.at(-1);
  return line?.slice(0, 240);
}

export function inside(base: string, relative: string | undefined): string | null {
  const trimmed = relative?.trim() ?? "";
  if (!trimmed) return base;
  if (path.isAbsolute(trimmed)) return null;
  const resolved = path.resolve(base, trimmed);
  return resolved === base || resolved.startsWith(base + path.sep) ? resolved : null;
}

export function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
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

function readTextPreview(root: string, relative: string): string | null {
  try {
    const info = statSync(path.join(root, relative));
    if (!info.isFile() || info.size > 20_000) return null;
    const bytes = readFileSync(path.join(root, relative));
    if (bytes.includes(0)) return null;
    return bytes.toString("utf8");
  } catch {
    return null;
  }
}

function listFiles(root: string): FileStamp[] {
  const out: FileStamp[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === ".git" || name === "node_modules" || name === "dist" || name === ".shepherd") continue;
      const full = path.join(dir, name);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) walk(full, depth + 1);
      else if (info.isFile()) out.push({ path: path.relative(root, full), size: info.size, mtimeMs: info.mtimeMs });
    }
  };
  walk(root, 0);
  return out;
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
