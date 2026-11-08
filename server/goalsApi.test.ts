import { createServer, type Server } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as folders from "./openTaskFolder";
import * as drafting from "./draft";
import * as models from "./models";
import { createEngine, type Engine } from "./engine";
import { createLooks } from "./looks";
import { createRunner, type Runner } from "./runner";
import { createSavedSteps } from "./savedSteps";
import { apiHandler, writeChecklist } from "./shepherdApi";
import { acceptanceItems } from "../src/model/acceptance";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function server() {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-goals-api-"));
  const engine = createEngine(path.join(root, "state.json"));
  const sandbox = path.join(root, "sandbox");
  mkdirSync(sandbox);
  const runner = createRunner({ engine, sandbox, worktrees: path.join(root, "worktrees"), evidence: path.join(root, "evidence"), gate: path.join(root, "gate"), loggedIn: async () => false });
  const handler = apiHandler({ engine, runner, sandbox, evidence: path.join(root, "evidence"), looks: path.join(root, "looks"), look: createLooks(engine, path.join(root, "looks")), saved: createSavedSteps(path.join(root, "saved.json")) });
  const http = createServer((req, res) => void handler(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => close(http, runner, engine));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("No test server address");
  const base = `http://127.0.0.1:${address.port}`;
  async function request(route: string, body?: unknown) {
    const response = await fetch(`${base}/api/${route}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  return { request, engine, runner, root, sandbox, base };
}

async function close(http: Server, runner: Runner, engine: Engine) {
  runner.close();
  await runner.idle();
  engine.close();
  await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
}

describe("goal API", () => {
  it("lets an agent use SHEPHERD_DONE to mark and withdraw, and refuses edited items and ended runs", async () => {
    const { request, engine, base } = await server();
    const created = await request("tasks", { goal: "goal-proj-local", name: "Build", agent: "codex", acceptance: ["Page loads", "Works on mobile"] });
    expect(created.status).toBe(201);
    const id = created.body.tasks[0].id;
    engine.dispatch({ type: "setStatus", id, status: "running" });
    const task = () => engine.get().tasks.find((task) => task.id === id)!;
    const run = engine.timelines.append(id, { kind: "run_started", text: "Started" }).run;
    const env = { ...process.env, SHEPHERD_URL: base, SHEPHERD_TASK_ID: id, SHEPHERD_RUN_ID: String(run), SHEPHERD_DONE_KEYS: JSON.stringify(acceptanceItems(task().acceptance).map((item) => item.key)) };
    const cli = (...args: string[]) => promisify(execFile)(process.execPath, [path.resolve("server/done-cli.mjs"), ...args], { env });
    expect((await cli("2", "Checked at 390px")).stdout).toContain("marked as met");
    expect(Object.values(task().acceptanceMarks!)).toEqual([{ at: expect.any(Number), note: "Checked at 390px" }]);
    const timeline = await request(`tasks/${id}/timeline?after=${run}`);
    expect(timeline.body.entries).toEqual([expect.objectContaining({ kind: "acceptance", item: 2, met: true, note: "Checked at 390px" })]);
    expect((await cli("2", "--undo")).stdout).toContain("mark taken back");
    expect(task().acceptanceMarks).toBeUndefined();
    await expect(cli("3", "No such item")).rejects.toThrow("no Done when item");
    await expect(cli("1")).rejects.toThrow("Usage:");
    await request("actions", { action: { type: "updateTask", id, patch: { acceptance: ["Page loads", "Mobile links work"] } } });
    await expect(cli("2", "Old prompt")).rejects.toThrow("changed or was removed");
    engine.timelines.append(id, { kind: "run_ended", text: "Agent finished", outcome: "completed" });
    await expect(cli("1", "Too late")).rejects.toThrow("no longer active");
  });
  it("serves a step timeline incrementally and removes it with the step", async () => {
    const { request, engine, root } = await server();
    const created = await request("tasks", { goal: "goal-proj-local", name: "Timeline", runner: "human" });
    const id = created.body.tasks[0].id;
    expect(await request(`tasks/${id}/timeline`)).toMatchObject({ status: 200, body: { entries: [], cursor: 0 } });
    engine.timelines.append(id, { kind: "run_started", text: "Started" });
    engine.timelines.append(id, { kind: "note", text: "Working" });
    expect(await request(`tasks/${id}/timeline?after=1`)).toMatchObject({ status: 200, body: { entries: [{ id: 2, text: "Working" }], cursor: 2 } });
    expect((await request(`tasks/${id}/timeline?after=2`)).body.entries).toEqual([]);
    expect((await request(`tasks/${id}/timeline?after=-1`)).status).toBe(400);
    expect((await request("tasks/missing/timeline")).status).toBe(404);
    expect(existsSync(path.join(root, "timelines", `${id}.jsonl`))).toBe(true);
    expect((await request("actions", { action: { type: "deleteTask", id } })).status).toBe(200);
    expect(existsSync(path.join(root, "timelines", `${id}.jsonl`))).toBe(false);
  });

  it("opens the chosen task folder through the goal endpoint and reports refused launches", async () => {
    const { request, engine } = await server();
    const launch = vi.spyOn(folders, "openTaskFolder").mockResolvedValue({ ok: true });
    expect(await request("goals/goal-proj-local/open", { app: "cursor" })).toMatchObject({ status: 200, body: { ok: true } });
    expect(launch).toHaveBeenCalledWith(engine.get(), "goal-proj-local", "cursor");
    launch.mockResolvedValue({ error: "The task folder is missing." });
    expect(await request("goals/goal-proj-local/open", { app: "finder" })).toMatchObject({ status: 409, body: { error: "The task folder is missing." } });
  });

  it("checks supplied repositories, rejects aliases already in use, and rechecks drafts and checklists", async () => {
    const { request, engine, root, sandbox } = await server();
    const repo = path.join(root, "my repo");
    mkdirSync(repo);
    const check = () => request(`projects/repo?path=${encodeURIComponent(repo)}`);
    expect((await check()).body.error).toContain(`${repo} is not a git repository`);
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Person", "-c", "user.email=p@test", "-c", "commit.gpgsign=false", ...args], { cwd: repo });
    git("init", "-q", "-b", "personal");
    expect((await check()).body.error).toContain(`${repo} has no commits`);
    expect((await request("projects", { name: "Empty", repo })).status).toBe(400);
    git("commit", "--allow-empty", "-qm", "Personal work");
    expect(await check()).toMatchObject({ status: 200, body: { repo: realpathSync(repo), branch: "personal" } });
    const created = await request("projects", { name: "My app", repo });
    expect(created).toMatchObject({ status: 201, body: { project: { repo: realpathSync(repo) } } });
    expect(engine.get().projects.at(-1)?.directory).toBeUndefined();
    const alias = path.join(root, "alias");
    symlinkSync(repo, alias);
    expect((await request(`projects/repo?path=${encodeURIComponent(alias)}`)).body.error).toMatch(/already.*My app/);
    expect((await request("projects", { name: "Same app", repo: alias })).body.error).toMatch(/already.*My app/);
    expect((await request("actions", { action: { type: "createProject", project: { id: "duplicate", name: "Duplicate", summary: "", repo: alias } } })).status).toBe(400);
    const goal = engine.get().goals.find((goal) => goal.projectId === created.body.project.id)!;
    const added = await request("tasks", { goal: goal.id, name: "Try it", runner: "human" });
    const task = engine.get().tasks.find((task) => task.id === added.body.tasks[0].id)!;
    const draft = vi.spyOn(drafting, "draftSteps").mockResolvedValue([]);
    const checklist = vi.spyOn(drafting, "draftChecklist").mockResolvedValue({ text: "Try it" });
    expect((await request("draft", { goal: goal.id, prompt: "Plan it" })).status).toBe(200);
    expect(draft.mock.calls[0]?.[1]).toBe(realpathSync(repo));
    expect(await writeChecklist(engine.get(), task, sandbox)).toEqual({ text: "Try it" });
    expect(checklist.mock.calls[0]?.[1]).toBe(realpathSync(repo));
    rmSync(repo, { recursive: true });
    // Even a surviving step folder cannot hide an invalid project repository.
    const staleTask = { ...task, git: { branch: "shepherd/old", folder: sandbox, target: "personal" } };
    expect((await request("draft", { goal: goal.id, prompt: "Plan it" })).body.error).toContain(repo);
    expect(await writeChecklist(engine.get(), staleTask, sandbox)).toHaveProperty("error", expect.stringContaining(repo));
    expect(draft).toHaveBeenCalledTimes(1);
    expect(checklist).toHaveBeenCalledTimes(1);
    expect(existsSync(repo)).toBe(false);
  }, 30_000);

  it("refuses a supplied repository already used by a workspace project", async () => {
    const { request, sandbox } = await server();
    const repo = path.join(sandbox, "workspace");
    mkdirSync(repo);
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=Person", "-c", "user.email=p@test", "-c", "commit.gpgsign=false", ...args], { cwd: repo });
    git("init", "-q");
    git("commit", "--allow-empty", "-qm", "First");
    expect((await request("projects", { name: "Duplicate", repo })).body.error).toMatch(/already.*Workspace/);
  });

  it("lists and creates tasks and accepts steps by goal id or name", async () => {
    const draft = vi.spyOn(drafting, "draftSteps").mockResolvedValue([]);
    const { request, engine } = await server();
    expect((await request("goals")).body.goals).toHaveLength(1);
    const created = await request("goals", { project: "Workspace", name: "Fix timeout", goal: "Finish checkout quickly" });
    expect(created.status).toBe(201);
    const goal = created.body.goal;
    expect(goal).toMatchObject({ projectId: "proj-local", name: "Fix timeout", goal: "Finish checkout quickly", outline: [], running: false, status: "open" });
    expect((await request("goals")).body.goals).toHaveLength(2);
    for (const key of [goal.id, goal.name]) {
      const added = await request("tasks", { goal: key, name: `Step ${key}`, runner: "human" });
      expect(added.status).toBe(201);
      expect(added.body.goal).toBe(goal.id);
    }
    expect(engine.get().tasks.every((task) => task.goalId === goal.id)).toBe(true);
    expect((await request("tasks")).body.projects[0].goals).toHaveLength(2);
    expect(draft).not.toHaveBeenCalled();
  });

  it.each([{}, { model: "gpt-6-astra", thinking: "high" }] as const)("creates a task with a drafted outline and preserves step details (%j)", async (choice) => {
    vi.spyOn(models, "modelCatalog").mockReturnValue({
      codex: { models: [], default: { model: null, effort: null } },
      claude: { models: [], default: { model: null, effort: null } },
    });
    const draft = vi.spyOn(drafting, "draftSteps").mockResolvedValue([
      { name: "Prepare", prompt: "Set up shared types", depth: 0, runner: "agent", acceptance: ["Types compile"], checkCommand: "npm run typecheck" },
      { name: "Build", prompt: "Build the feature", depth: 1, runner: "agent", acceptance: ["Feature works"], checkCommand: "npm test" },
      { name: "Document", prompt: "Write usage examples", depth: 1, runner: "agent", acceptance: ["Examples are current"] },
      { name: "Try it", prompt: "Try the finished feature", depth: 0, runner: "human", acceptance: ["Looks right", "Works on mobile"] },
    ]);
    const { request, engine, sandbox } = await server();
    const created = await request("goals", { project: "Workspace", name: "Feature", goal: "  Ship the feature  ", draft: true, ...choice });
    expect(created.status).toBe(201);
    const goal = created.body.goal;
    expect(goal).toMatchObject({ name: "Feature", goal: "Ship the feature", status: "open", running: false });
    expect(draft).toHaveBeenCalledExactlyOnceWith("Ship the feature", path.join(sandbox, "workspace"), {
      model: "model" in choice ? choice.model : undefined,
      effort: "thinking" in choice ? choice.thinking : undefined,
    }, expect.any(AbortSignal));
    const tasks = engine.get().tasks.filter((task) => task.goalId === goal.id);
    expect(tasks).toHaveLength(4);
    const [prepare, build, docs, tryIt] = tasks;
    expect(prepare).toMatchObject({ objective: "Set up shared types", acceptance: ["Types compile"], runner: "agent", checkCommand: "npm run typecheck", verification: [{ kind: "command", command: "npm run typecheck", state: "pending" }] });
    expect(build).toMatchObject({ objective: "Build the feature", acceptance: ["Feature works"], checkCommand: "npm test" });
    expect(docs).toMatchObject({ objective: "Write usage examples", acceptance: ["Examples are current"] });
    expect(tryIt).toMatchObject({ objective: "Try the finished feature", runner: "human", agentId: null, acceptance: ["Looks right", "Works on mobile"], verification: [] });
    expect(tryIt).not.toHaveProperty("checkCommand");
    expect(goal.outline).toEqual(tasks.map((task, index) => ({ id: task.id, depth: index === 1 || index === 2 ? 1 : 0 })));
    expect(created.body.steps).toEqual([
      { id: prepare!.id, name: "Prepare", depth: 0, runner: "agent", dependsOn: [] },
      { id: build!.id, name: "Build", depth: 1, runner: "agent", dependsOn: [{ task: prepare!.id, gate: "verified" }] },
      { id: docs!.id, name: "Document", depth: 1, runner: "agent", dependsOn: [{ task: prepare!.id, gate: "verified" }] },
      { id: tryIt!.id, name: "Try it", depth: 0, runner: "human", dependsOn: [{ task: build!.id, gate: "verified" }, { task: docs!.id, gate: "verified" }] },
    ]);
    expect(created.body).not.toHaveProperty("note");
    expect(engine.get().goals.find((item) => item.id === goal.id)).toEqual(goal);
  });

  it("includes map advice for a drafted single step", async () => {
    vi.spyOn(drafting, "draftSteps").mockResolvedValue([{ name: "Fix", prompt: "Fix the timeout", depth: 0, runner: "agent", acceptance: [] }]);
    const { request } = await server();
    const created = await request("goals", { project: "Workspace", name: "Timeout", goal: "Fix the timeout", draft: true });
    expect(created.status).toBe(201);
    expect(created.body.steps).toHaveLength(1);
    expect(created.body.note).toContain("one step");
  });

  it.each([false, true])("keeps the task without steps when drafting fails, and lets the caller retry (throws: %s)", async (throws) => {
    const draft = vi.spyOn(drafting, "draftSteps");
    if (throws) draft.mockRejectedValueOnce(new Error("Codex is unavailable"));
    else draft.mockResolvedValueOnce({ error: "Codex is unavailable" });
    const { request, engine } = await server();
    const failed = await request("goals", { project: "Workspace", name: "Timeout", goal: "Fix checkout", draft: true });
    expect(failed.status).toBe(throws ? 500 : 409);
    expect(failed.body).toEqual({ error: "Codex is unavailable", goal: expect.any(String) });
    expect(engine.get().goals.find((goal) => goal.id === failed.body.goal)).toMatchObject({ name: "Timeout", goal: "Fix checkout", outline: [], status: "open" });
    expect(engine.get().tasks).toEqual([]);
    expect(engine.get().dependencies).toEqual([]);
    draft.mockResolvedValueOnce([{ name: "Fix", prompt: "Fix checkout", depth: 0, runner: "agent", acceptance: [] }]);
    const retry = await request("draft", { goal: failed.body.goal });
    expect(retry.status).toBe(200);
    expect(retry.body.steps).toHaveLength(1);
    expect(draft.mock.calls[1]?.[0]).toBe("Fix checkout");
    expect(engine.get().tasks).toEqual([]);
  });

  it.each([
    { goal: "" }, { goal: "x".repeat(4001) }, { model: "--bad" }, { thinking: "sometimes" },
  ])("uses draft endpoint validation and keeps the created task (%j)", async (invalid) => {
    const draft = vi.spyOn(drafting, "draftSteps").mockResolvedValue([]);
    const { request, engine } = await server();
    const failed = await request("goals", { project: "Workspace", name: "Timeout", goal: "Fix checkout", draft: true, ...invalid });
    expect(failed.status).toBe(400);
    expect(failed.body).toEqual({ error: expect.any(String), goal: expect.any(String) });
    expect(engine.get().goals.find((goal) => goal.id === failed.body.goal)?.outline).toEqual([]);
    expect(engine.get().tasks).toEqual([]);
    expect(draft).not.toHaveBeenCalled();
  });

  it("adds outline branches through POST tasks and rejects depth with explicit dependencies without adding steps", async () => {
    const { request, engine } = await server();
    const goal = "goal-proj-local";
    const added = await request("tasks", { goal, tasks: [
      { name: "Prepare", depth: 0 }, { name: "Build", depth: 1 },
      { name: "Write docs", depth: 1 }, { name: "Finish", depth: 0 },
    ] });
    expect(added.status).toBe(201);
    const [prepare, build, docs, finish] = added.body.tasks.map((task: { id: string }) => task.id);
    expect(engine.get().dependencies.map((dep) => [dep.source, dep.target])).toEqual([
      [prepare, build], [prepare, docs], [build, finish], [docs, finish],
    ]);
    expect(added.body.steps).toEqual([
      { id: prepare, name: "Prepare", depth: 0, runner: "agent", dependsOn: [] },
      { id: build, name: "Build", depth: 1, runner: "agent", dependsOn: [{ task: prepare, gate: "verified" }] },
      { id: docs, name: "Write docs", depth: 1, runner: "agent", dependsOn: [{ task: prepare, gate: "verified" }] },
      { id: finish, name: "Finish", depth: 0, runner: "agent", dependsOn: [{ task: build, gate: "verified" }, { task: docs, gate: "verified" }] },
    ]);
    expect(added.body).not.toHaveProperty("note");
    const manual = await request("tasks", { goal, name: "Manual", dependsOn: [{ task: prepare, gate: "completed" }] });
    expect(manual.status).toBe(201);
    expect(manual.body.tasks).toHaveLength(1);
    expect(manual.body.steps).toHaveLength(5);
    expect(manual.body.steps.slice(0, 4)).toEqual(added.body.steps);
    expect(manual.body.steps[4]).toMatchObject({ name: "Manual", dependsOn: [{ task: prepare, gate: "completed" }] });
    expect(manual.body).not.toHaveProperty("note");
    expect(engine.get().dependencies.filter((dep) => dep.target === manual.body.tasks[0].id))
      .toEqual([expect.objectContaining({ source: prepare, gate: "completed" })]);
    const before = engine.get();
    for (const body of [
      { goal, name: "Conflict", depth: 0, dependsOn: [prepare] },
      { goal, tasks: [{ name: "Valid", depth: 0 }, { name: "Conflict", depth: 1, dependsOn: [] }] },
    ]) {
      expect(await request("tasks", body)).toMatchObject({ status: 400, body: { error: expect.stringMatching(/pick one.*depth.*dependsOn/) } });
      expect(engine.get()).toBe(before);
    }
  });

  it("returns advice without refusing single steps or long lines, based on the whole task", async () => {
    const { request } = await server();
    const goal = "goal-proj-local";
    const first = await request("tasks", { goal, name: "Prepare" });
    expect(first.status).toBe(201);
    expect(first.body.steps).toEqual([{ id: first.body.tasks[0].id, name: "Prepare", depth: 0, runner: "agent", dependsOn: [] }]);
    expect(first.body.note).toContain("one step");
    expect(first.body.note).toContain("different files can run side by side");
    expect(first.body.note).toContain("A person's step can close the task");
    const short = await request("tasks", { goal, tasks: [{ name: "Build" }, { name: "Check" }] });
    expect(short.status).toBe(201);
    expect(short.body.steps).toHaveLength(3);
    expect(short.body).not.toHaveProperty("note");
    const line = await request("tasks", { goal, name: "Try", runner: "human" });
    expect(line.status).toBe(201);
    expect(line.body.steps.map((step: { name: string }) => step.name)).toEqual(["Prepare", "Build", "Check", "Try"]);
    expect(line.body.steps[3]).toMatchObject({ runner: "human", dependsOn: [{ task: short.body.tasks[1].id, gate: "verified" }] });
    expect(line.body.note).toContain("straight line of 4 steps");
    const other = await request("goals", { project: "Workspace", name: "Other" });
    const alone = await request("tasks", { goal: other.body.goal.id, name: "Other work" });
    expect(alone.body.steps).toHaveLength(1);
    expect(alone.body.note).toContain("one step");
  });

  it("lists choices for ambiguous project-only steps, drafts and plan commands", async () => {
    const { request, engine, runner } = await server();
    const created = await request("goals", { project: "Workspace", name: "Other", goal: "Other work" });
    for (const [route, body] of [
      ["tasks", { project: "Workspace", name: "A step" }],
      ["draft", { project: "Workspace", prompt: "Break this up" }],
      ["draft", { projectId: "proj-local" }],
    ] as const) {
      const result = await request(route, body);
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/several open tasks.*Workspace.*Other/);
    }
    for (const command of ["runPlan", "stopPlan", "mergePlan"]) {
      expect(await runner.handle({ command, projectId: "proj-local" })).toHaveProperty("error", expect.stringContaining("several open tasks"));
    }
    engine.dispatch({ type: "archiveGoal", id: "goal-proj-local" });
    expect((await request("tasks", { project: "Workspace", name: "Only open task", runner: "human" })).status).toBe(201);
    expect(engine.get().tasks[0]?.goalId).toBe(created.body.goal.id);
  });

  it("drafts from the selected task's text or an explicit prompt without invoking an agent", async () => {
    const draft = vi.spyOn(drafting, "draftSteps").mockResolvedValue([{ name: "Test it", prompt: "Test checkout", depth: 0, runner: "agent", acceptance: ["Checkout works"], checkCommand: "npm test" }, { name: "Try it", prompt: "Try checkout", depth: 1, runner: "human", acceptance: ["Looks right"] }]);
    const { request } = await server();
    const created = await request("goals", { project: "Workspace", name: "Timeout", goal: "Fix checkout" });
    const result = await request("draft", { goal: created.body.goal.id });
    expect(result.status).toBe(200);
    expect(result.body.steps).toEqual(await draft.mock.results[0]?.value);
    expect(draft.mock.calls[0]?.[0]).toBe("Fix checkout");
    expect((await request("draft", { project: "Workspace", goal: "Timeout", prompt: "Investigate first" })).status).toBe(200);
    expect(draft.mock.calls[1]?.[0]).toBe("Investigate first");
    expect((await request("draft", { goal: "missing" })).body.error).toMatch(/no task missing/);
  });
});
