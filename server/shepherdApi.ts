import { fileURLToPath } from "node:url";
import { createSecurity } from "./security";
import { startupWarnings } from "./startup";
import { createReadStream, existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Plugin } from "vite";
import { resolveGoal } from "../src/model/goals";
import { workspace } from "../src/model/workspace";
import { agentChoice, isEffort, isModelId, type ModelCatalog } from "../src/model/models";
import { EFFORTS, type Action, type OrchestrationState, type Task } from "../src/model/types";
import { createEngine, envelope, tabAction, type Engine } from "./engine";
import { gitAvailable } from "./git";
import { checklistInput, draftChecklist, draftSteps } from "./draft";
import { boardSummary, planGoal, planProject, planTasks } from "./intake";
import { LookRefused, createLooks } from "./looks";
import { modelCatalog } from "./models";
import { markProgress } from "./progress";
import { openTaskFolder } from "./openTaskFolder";
import { availableRepo } from "./projectRepos";
import { agentStatus, createRunner, inside, projectFolder, type Runner } from "./runner";
import { createSavedSteps, type SavedSteps } from "./savedSteps";
import { removeSession, writeSession } from "./session";

/** The longest goal Shepherd sends to an agent to plan. */
const GOAL_LIMIT = 4000;

/** How often an open tab hears about changes while agents are busy. */
const STREAM_THROTTLE_MS = 250;

class BadRequest extends Error {}

export interface AppOptions {
  dataDir: string;
  projectsDir: string;
  helpersDir?: string;
  origin: () => string | null;
  /** Demo boards never create a runner or read the person's agent settings. */
  demo?: { models: ModelCatalog };
}

/** Both launchers use the same board, runner, routes and authentication boundary. */
export function createApp(options: AppOptions) {
  const { dataDir: shepherd, projectsDir: sandbox } = options;
  const helpers = options.helpersDir ?? path.dirname(fileURLToPath(import.meta.url));
  mkdirSync(shepherd, { recursive: true, mode: 0o700 });
  mkdirSync(sandbox, { recursive: true, mode: 0o700 });
  const security = createSecurity(options.origin);
  const engine = createEngine(path.join(shepherd, "state.json"), undefined, options.demo ? { ...workspace(), projects: [], goals: [] } : undefined);
  const evidence = path.join(shepherd, "evidence");
  const looks = path.join(shepherd, "looks");
  const runner: Runner = options.demo ? {
    handle: async () => ({ error: "This is a demo. Agent runs and commands are disabled." }),
    cancel() {}, cancelAll() {}, close() {}, schedule() {}, async idle() {},
  } : createRunner({
    engine,
    sandbox,
    worktrees: path.join(shepherd, "worktrees"),
    evidence,
    gate: path.join(helpers, "../gates/shepherd-gate.mjs"),
    authToken: security.token,
    look: { script: path.join(helpers, "look-cli.mjs"), server: options.origin },
    done: { script: path.join(helpers, "done-cli.mjs"), server: options.origin },
    checklist: (board, task, signal) => writeChecklist(board, task, sandbox, signal),
  });
  const saved = createSavedSteps(path.join(shepherd, "saved-steps.json"));
  const handle = apiHandler({ engine, runner, sandbox, evidence, looks, look: createLooks(engine, looks), saved, demo: !!options.demo });
  const stop = () => {
    runner.close();
    engine.close();
    if (!options.demo) removeSession(shepherd, security.token);
  };
  return {
    engine,
    runner,
    security,
    stop,
    announce() {
      if (options.demo) return;
      const url = options.origin();
      if (url) writeSession(shepherd, { url, token: security.token, guide: `${url}/api/guide`, pid: process.pid });
    },
    handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
      if (!security.allow(req, res)) return;
      if (options.demo) {
        const url = new URL(req.url ?? "/", "http://shepherd.local");
        if (url.pathname === "/api/models") return sendJson(res, 200, options.demo.models);
        if (url.pathname === "/api/agents") return sendJson(res, 200, { codex: true, claude: true, git: true, workspace: "Demo workspace" });
        if (url.pathname.startsWith("/api/") && ![
          "/api/state", "/api/stream", "/api/tasks", "/api/goals", "/api/saved-steps",
        ].includes(url.pathname) && !/^\/api\/tasks\/[\w.-]+\/timeline$/.test(url.pathname) && url.pathname !== "/api/actions" && url.pathname !== "/api/progress") {
          return sendJson(res, 409, { error: "This is a demo. Agent runs, drafts and external actions are disabled." });
        }
      }
      void handle(req, res, next);
    },
  };
}

export function shepherdApi(): Plugin {
  return {
    name: "shepherd-api",
    configureServer(server) {
      const root = server.config.root;
      const app = createApp({
        dataDir: path.resolve(process.env.SHEPHERD_DATA_DIR || path.join(root, ".shepherd")),
        projectsDir: path.resolve(process.env.SHEPHERD_PROJECTS_DIR || path.join(root, ".agent-sandbox")),
        helpersDir: path.join(root, "server"),
        origin: () => serverUrl(server.httpServer?.address()),
      });
      server.middlewares.use(app.handle);
      // Vite replaces this plugin on edits; the previous runner must never write again.
      const stop = () => {
        app.stop();
        process.removeListener("exit", stop);
      };
      server.httpServer?.once("close", stop);
      process.once("exit", stop);
      server.httpServer?.once("listening", () => {
        app.announce();
        console.log(`\nShepherd: ${app.security.address()}\nOpen this address to unlock the board.\n`);
        void startupWarnings().then((warnings) => warnings.forEach((warning) => console.warn(warning)));
      });
    },
  };
}

/** Where agents reach this server. A wildcard address is reached on loopback. */
export function serverUrl(address: AddressInfo | string | null | undefined): string | null {
  if (!address || typeof address === "string") return null;
  const host = address.address === "::" || address.address === "0.0.0.0" ? "127.0.0.1" : address.address;
  return `http://${host.includes(":") ? `[${host}]` : host}:${address.port}`;
}

/** A person's checklist, drafted in their step's folder once it exists, or else the project folder. */
export async function writeChecklist(board: OrchestrationState, task: Task, sandbox: string, signal?: AbortSignal): Promise<{ text: string } | { error: string }> {
  const project = board.projects.find((item) => item.id === task.projectId);
  const base = await projectFolder(board.workspace, project?.directory, sandbox, project?.repo);
  if ("error" in base) return base;
  const folder = task.git?.folder && existsSync(task.git.folder) ? { path: task.git.folder } : base;
  if (!project?.repo) mkdirSync(folder.path, { recursive: true });
  return draftChecklist(checklistInput(board, task), folder.path, agentChoice({}, modelCatalog().codex.default), signal);
}

interface Context {
  engine: Engine;
  runner: Runner;
  sandbox: string;
  evidence: string;
  looks: string;
  look: ReturnType<typeof createLooks>;
  saved: SavedSteps;
  demo?: boolean;
}

export function apiHandler(context: Context) {
  let counter = 0;
  const stamp = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://shepherd.local");
    if (!url.pathname.startsWith("/api/")) {
      next();
      return;
    }
    // A JSON content type makes another site's request need a CORS preflight, which this server never grants.
    if ((req.method === "POST" || req.method === "PUT") && !/^application\/json\b/i.test(req.headers["content-type"] ?? "")) {
      sendJson(res, 415, { error: "Send JSON with content-type: application/json." });
      return;
    }
    try {
      if (!(await route(context, url, req, res, stamp))) next();
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, error instanceof BadRequest ? 400 : 500, { error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
}

async function route(
  { engine, runner, sandbox, evidence, looks, look, saved, demo }: Context,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  stamp: () => string,
): Promise<boolean> {
  const { pathname } = url;
  const method = req.method ?? "GET";
  if (pathname === "/api/progress" && method === "POST") {
    const result = markProgress(engine, await readJson(req));
    sendJson(res, "error" in result ? 409 : 200, result);
    return true;
  }
  if (pathname === "/api/state" && method === "GET") {
    sendJson(res, 200, { ...envelope(engine.get()), revision: engine.version() });
    return true;
  }
  if (pathname === "/api/state" && method === "DELETE") {
    runner.cancelAll();
    engine.dispatch({ type: "reset" });
    sendJson(res, 200, { ok: true, revision: engine.version() });
    return true;
  }
  if (pathname === "/api/stream" && method === "GET") {
    stream(engine, req, res);
    return true;
  }
  if (pathname === "/api/actions" && method === "POST") {
    const body = (await readJson(req)) as { action?: unknown; actions?: unknown };
    const list = Array.isArray(body.actions) ? body.actions : [body.action];
    const errors: string[] = [];
    for (const raw of list) {
      const action = tabAction(engine.get(), raw);
      if ("error" in action) {
        errors.push(action.error);
        continue;
      }
      if (action.type === "createProject" && action.project.repo !== undefined) {
        if (demo) { errors.push("Demo projects use throwaway folders only."); continue; }
        try {
          action.project.repo = (await availableRepo(action.project.repo, engine.get, sandbox)).repo;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
          continue;
        }
      }
      if (action.type === "deleteTask") runner.cancel(action.id);
      if (action.type === "deleteGoal" || action.type === "finishGoal" || action.type === "archiveGoal") {
        for (const step of engine.get().tasks.filter((step) => step.goalId === action.id)) {
          runner.cancel(step.id);
          if (step.status === "running" && action.type !== "deleteGoal") engine.dispatch({ type: "setStatus", id: step.id, status: "blocked" });
        }
      }
      if (action.type === "reset") runner.cancelAll();
      engine.dispatch(action);
    }
    sendJson(res, errors.length ? 400 : 200, { revision: engine.version(), ...(errors.length ? { error: errors.join(" ") } : { ok: true }) });
    return true;
  }
  if (pathname === "/api/commands" && method === "POST") {
    const result = await runner.handle(await readJson(req));
    sendJson(res, "error" in result ? 409 : 200, { ...result, revision: engine.version() });
    return true;
  }
  if (pathname === "/api/tasks" && method === "GET") {
    sendJson(res, 200, boardSummary(engine.get()));
    return true;
  }
  const timeline = /^\/api\/tasks\/([\w.-]+)\/timeline$/.exec(pathname);
  if (timeline && method === "GET") {
    if (!engine.get().tasks.some((task) => task.id === timeline[1])) {
      sendJson(res, 404, { error: "There is no such step." });
      return true;
    }
    const after = Number(url.searchParams.get("after") ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) throw new BadRequest("after must be an entry id, starting at 0.");
    res.setHeader("Cache-Control", "no-store");
    sendJson(res, 200, engine.timelines.read(timeline[1], after));
    return true;
  }
  if (pathname === "/api/tasks" && method === "POST") {
    const id = stamp();
    const planned = planTasks(engine.get(), await readJson(req), (index) => `task-api-${id}-${index + 1}`);
    if ("error" in planned) {
      sendJson(res, 400, planned);
      return true;
    }
    planned.actions.forEach((action: Action) => engine.dispatch(action));
    sendJson(res, 201, { project: planned.projectId, goal: planned.goalId, tasks: planned.tasks, note: "Added to the board." });
    return true;
  }
  const openFolder = /^\/api\/goals\/([\w.-]+)\/open$/.exec(pathname);
  if (openFolder && method === "POST") {
    const body = (await readJson(req)) as { app?: unknown } | null;
    const result = await openTaskFolder(engine.get(), openFolder[1]!, body?.app);
    sendJson(res, "error" in result ? 409 : 200, result);
    return true;
  }
  if (pathname === "/api/goals" && method === "GET") {
    sendJson(res, 200, { goals: engine.get().goals });
    return true;
  }
  if (pathname === "/api/goals" && method === "POST") {
    const planned = planGoal(engine.get(), await readJson(req), `goal-api-${stamp()}`);
    if ("error" in planned) sendJson(res, 400, planned);
    else {
      engine.dispatch(planned.action);
      sendJson(res, 201, { goal: planned.goal });
    }
    return true;
  }
  if (pathname === "/api/projects/repo" && method === "GET") {
    try {
      sendJson(res, 200, await availableRepo(url.searchParams.get("path") ?? "", engine.get, sandbox));
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }
  if (pathname === "/api/projects" && method === "POST") {
    const planned = planProject(engine.get(), await readJson(req), `proj-api-${stamp()}`);
    if ("error" in planned) {
      sendJson(res, 400, planned);
      return true;
    }
    if (planned.project.repo) {
      try {
        planned.project.repo = (await availableRepo(planned.project.repo, engine.get, sandbox)).repo;
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return true;
      }
    }
    engine.dispatch(planned.action);
    sendJson(res, 201, { project: planned.project, note: "Added to the board." });
    return true;
  }
  if (pathname === "/api/draft" && method === "POST") {
    const body = (await readJson(req)) as { project?: unknown; projectId?: unknown; goal?: unknown; prompt?: unknown; model?: unknown; thinking?: unknown };
    const board = engine.get();
    const selected = resolveGoal(board, body.goal, body.project ?? body.projectId);
    if ("error" in selected) throw new BadRequest(selected.error);
    if (selected.status !== "open") throw new BadRequest("Reopen this task before drafting steps.");
    const project = board.projects.find((item) => item.id === selected.projectId)!;
    const goal = typeof body.prompt === "string" ? body.prompt.trim() : selected.goal;
    if (!goal) throw new BadRequest("Say what you want done in the task's goal text or as prompt.");
    if (goal.length > GOAL_LIMIT) throw new BadRequest(`Keep the goal under ${GOAL_LIMIT} characters.`);
    const { model = null, thinking = null } = body;
    if (model !== null && !isModelId(model)) throw new BadRequest("model is not a model name, such as gpt-6-astra.");
    if (thinking !== null && !isEffort(thinking)) throw new BadRequest(`thinking must be one of: ${EFFORTS.join(", ")}.`);
    const choice = agentChoice({ model: model ?? undefined, effort: thinking ?? undefined }, modelCatalog().codex.default);
    const folder = await projectFolder(board.workspace, project.directory, sandbox, project.repo);
    if ("error" in folder) {
      sendJson(res, 409, { error: folder.error });
      return true;
    }
    if (!project.repo) mkdirSync(folder.path, { recursive: true });
    const abandon = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abandon.abort();
    });
    const result = await draftSteps(goal, folder.path, choice, abandon.signal);
    if (!res.destroyed) sendJson(res, Array.isArray(result) ? 200 : 409, Array.isArray(result) ? { steps: result } : result);
    return true;
  }
  if (pathname === "/api/look" && method === "POST") {
    try {
      sendJson(res, 200, await look(await readJson(req)));
    } catch (error) {
      if (!(error instanceof LookRefused)) throw error;
      sendJson(res, 409, { error: error.message });
    }
    return true;
  }
  const shot = /^\/api\/looks\/([\w.-]+)\/([\w.-]+\.png)$/.exec(pathname);
  if (shot && method === "GET") {
    serveFile(looks, shot[1]!, shot[2]!, res, "No such screenshot. A step keeps only its latest ones.");
    return true;
  }
  if (pathname === "/api/agents" && method === "GET") {
    const [status, git] = await Promise.all([agentStatus(), gitAvailable()]);
    sendJson(res, 200, { ...status, git, workspace: sandbox });
    return true;
  }
  if (pathname === "/api/models" && method === "GET") {
    sendJson(res, 200, modelCatalog());
    return true;
  }
  if (pathname === "/api/saved-steps" && method === "GET") {
    sendJson(res, 200, { steps: saved.list() });
    return true;
  }
  if (pathname === "/api/saved-steps" && method === "PUT") {
    const result = saved.replace(((await readJson(req)) as { steps?: unknown }).steps);
    sendJson(res, Array.isArray(result) ? 200 : 400, Array.isArray(result) ? { steps: result } : result);
    return true;
  }
  const file = /^\/api\/evidence\/([\w.-]+)\/(.+)$/.exec(pathname);
  if (file && method === "GET") {
    serveFile(evidence, file[1]!, decodeURIComponent(file[2]!), res, "No such evidence file. A newer check may have replaced it.");
    return true;
  }
  return false;
}

/** Sends the whole board now and again after changes, at most every STREAM_THROTTLE_MS. */
function stream(engine: Engine, req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  let sent = -1;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const send = () => {
    timer = null;
    const revision = engine.version();
    if (revision === sent) return;
    sent = revision;
    res.write(`data: ${JSON.stringify({ revision, state: engine.get() })}\n\n`);
  };
  send();
  const unsubscribe = engine.subscribe(() => {
    timer ??= setTimeout(send, STREAM_THROTTLE_MS);
  });
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => {
    unsubscribe();
    clearInterval(ping);
    if (timer) clearTimeout(timer);
  });
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".zip": "application/zip",
};

function serveFile(root: string, taskId: string, relative: string, res: ServerResponse, missing: string) {
  const base = path.join(root, taskId);
  let file = inside(base, relative);
  try {
    if (file && statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!file || !statSync(file).isFile() || !realpathSync(file).startsWith(realpathSync(base) + path.sep)) throw new Error();
  } catch {
    sendJson(res, 404, { error: missing });
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file).toLowerCase()] ?? "text/plain; charset=utf-8",
    "cache-control": "no-store",
    // Reports are written by the code under test, so their pages run without access to Shepherd's origin.
    "content-security-policy": "sandbox allow-scripts allow-popups",
    "x-content-type-options": "nosniff",
  });
  createReadStream(file).pipe(res);
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
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
      } catch {
        reject(new BadRequest("The request body is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}
