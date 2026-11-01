import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blankTask, newStep } from "../src/model/factory";
import { reducer } from "../src/model/reducer";
import type { OrchestrationState, Task } from "../src/model/types";
import { isFullyVerified } from "../src/model/verify";
import { WORKSPACE_PROJECT_ID, workspace } from "../src/model/workspace";
import { createEngine, envelope } from "./engine";
import { commitAll, ensureRepo, openWorktree } from "./git";
import { createRunner, type RunnerOptions } from "./runner";

function gitOut(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=Person", "-c", "user.email=person@example.test", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
}

/** Stands in for Codex: writes a file named after its step, then reports like Codex does. */
const FAKE_AGENT = `
import { appendFileSync, writeFileSync } from "node:fs";
const [log, prompt] = process.argv.slice(2);
const name = /Objective: Do (\\w+)/.exec(prompt)[1].toLowerCase();
writeFileSync(name + ".txt", name + "\\n");
appendFileSync(log, JSON.stringify({ name, prompt, env: { branch: process.env.SHEPHERD_TASK_BRANCH, folder: process.env.SHEPHERD_TASK_FOLDER, base: process.env.SHEPHERD_TASK_BASE } }) + "\\n");
const say = (event) => console.log(JSON.stringify(event));
say({ type: "thread.started", thread_id: "thread-" + name });
say({ type: "item.completed", item: { type: "agent_message", text: "Report from " + name + ": wrote " + name + ".txt" } });
say({ type: "turn.completed" });
`;

function planServer(board: OrchestrationState, checklist?: RunnerOptions["checklist"], agentSource = FAKE_AGENT) {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-plan-"));
  const sandbox = path.join(root, "sandbox");
  mkdirSync(path.join(sandbox, "workspace"), { recursive: true });
  const agent = path.join(root, "agent.mjs");
  const log = path.join(root, "prompts.jsonl");
  writeFileSync(agent, agentSource);
  const file = path.join(root, "state.json");
  writeFileSync(file, JSON.stringify(envelope(board)));
  const engine = createEngine(file);
  const runner = createRunner({
    engine,
    sandbox,
    worktrees: path.join(root, "worktrees"),
    evidence: path.join(root, "evidence"),
    gate: path.join(root, "gate.mjs"),
    loggedIn: async () => true,
    command: (_provider, prompt) => ({ cmd: process.execPath, args: [agent, log, prompt] }),
    checklist,
  });
  const prompts = () =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { name: string; prompt: string; env: { branch: string; folder: string; base: string } });
  return { engine, runner, prompts, project: path.join(sandbox, "workspace") };
}

function outlined(spec: string): OrchestrationState {
  const steps = spec.split("\n").map((line) => {
    const name = line.trim();
    return { task: { ...newStep(WORKSPACE_PROJECT_ID, name, `Do ${name}`), id: `step-${name.toLowerCase()}` }, depth: (line.length - line.trimStart().length) / 2 };
  });
  return reducer(workspace(0), { type: "addSteps", goalId: `goal-${WORKSPACE_PROJECT_ID}`, after: null, steps });
}

/** A server starting on a saved board, with no agent signed in so nothing but checks can run. */
function restartWith(task: Task) {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-runner-"));
  const sandbox = path.join(root, "sandbox");
  mkdirSync(path.join(sandbox, "workspace"), { recursive: true });
  writeFileSync(path.join(sandbox, "workspace", "proof.txt"), "ok\n");
  const file = path.join(root, "state.json");
  writeFileSync(file, JSON.stringify(envelope({ ...workspace(0), tasks: [task] })));
  const engine = createEngine(file);
  const runner = createRunner({
    engine,
    sandbox,
    worktrees: path.join(root, "worktrees"),
    evidence: path.join(root, "evidence"),
    gate: path.join(root, "gate.mjs"),
    loggedIn: async () => false,
  });
  return { engine, runner };
}

function finishedTask(): Task {
  const task = blankTask({
    id: "task-proof",
    projectId: WORKSPACE_PROJECT_ID,
    name: "Write proof",
    objective: "Write proof.txt",
    agentId: "agent-codex",
    position: { x: 0, y: 0 },
    checkCommand: "test -f proof.txt",
    review: false,
  });
  return { ...task, status: "completed" };
}

describe("scheduler", () => {
  it("records a stopped run without losing its progress notes", async () => {
    const board = outlined("Build");
    const id = board.tasks[0].id;
    const server = planServer(board, undefined, FAKE_AGENT + '\nsetInterval(() => {}, 1000);');
    try {
      await server.runner.handle({ command: "run", taskId: id });
      await expect.poll(() => server.engine.timelines.read(id).entries.some((entry) => entry.kind === "note"), { timeout: 10000 }).toBe(true);
      await server.runner.handle({ command: "stop", taskId: id });
      await server.runner.idle();
      expect(server.engine.timelines.read(id).entries.at(-1)).toMatchObject({ kind: "run_ended", outcome: "stopped" });
      expect(server.engine.get().tasks[0].status).toBe("blocked");
    } finally { server.runner.close(); server.engine.close(); }
  });

  for (const provider of ["codex", "claude"] as const) it(`records ${provider} streams and checks outside the board, grouped by run`, async () => {
    let board = outlined("Build");
    const id = board.tasks[0].id;
    board = reducer(board, { type: "setCheckCommand", id, command: "test -f build.txt" });
    if (provider === "claude") board = reducer(board, { type: "reassign", id, agentId: "agent-claude", runner: "agent" });
    const stream = provider === "codex" ? `
say({ type: "item.completed", item: { type: "agent_message", text: "Unique progress note" } });
say({ type: "item.started", item: { type: "command_execution", id: "cmd", command: "echo build\\necho hidden" } });
say({ type: "item.completed", item: { type: "command_execution", id: "cmd", command: "echo build\\necho hidden", exit_code: 0 } });
` : `
say({ type: "assistant", message: { content: [{ type: "text", text: "Unique progress note" }, { type: "tool_use", id: "cmd", name: "Bash", input: { command: "echo build\\necho hidden" } }] } });
say({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "cmd", is_error: false }] } });
`;
    const server = planServer(board, undefined, FAKE_AGENT.replace('say({ type: "thread.started"', `${stream}\nsay({ type: "thread.started"`));
    try {
      await server.runner.handle({ command: "run", taskId: id });
      await server.runner.idle();
      const first = server.engine.timelines.read(id);
      expect(first.entries.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["run_started", "note", "command", "command_end", "files", "report", "run_ended", "check_started", "check_ended"]));
      expect(new Set(first.entries.map((entry) => entry.run)).size).toBe(1);
      expect(first.entries.find((entry) => entry.kind === "command")).toMatchObject({ text: "echo build" });
      expect(first.entries.find((entry) => entry.kind === "check_ended")).toMatchObject({ ok: true });
      expect(JSON.stringify(server.engine.get())).not.toMatch(/Unique progress note|echo hidden|echo build/);
      expect(server.engine.get().tasks[0].output).toContain("Report from build");
      await server.runner.handle({ command: "run", taskId: id });
      await server.runner.idle();
      expect(new Set(server.engine.timelines.read(id).entries.map((entry) => entry.run)).size).toBe(2);
      expect(server.engine.timelines.read(id, first.cursor).entries[0]).toMatchObject({ kind: "run_started", text: "Resumed" });
    } finally { server.runner.close(); server.engine.close(); }
  });

  it("runs in an external repository's new branch without changing its checkout or existing branches", async () => {
    const repo = mkdtempSync(path.join(tmpdir(), "shepherd-existing-"));
    gitOut(repo, "init", "-q", "-b", "my-main");
    writeFileSync(path.join(repo, "mine.txt"), "committed\n");
    gitOut(repo, "add", ".");
    gitOut(repo, "commit", "-qm", "My initial work");
    gitOut(repo, "branch", "other-work");
    gitOut(repo, "branch", "shepherd/build");
    writeFileSync(path.join(repo, "mine.txt"), "staged\n");
    gitOut(repo, "add", "mine.txt");
    writeFileSync(path.join(repo, "mine.txt"), "unstaged\n");
    writeFileSync(path.join(repo, "untracked.txt"), "untracked\n");
    const status = gitOut(repo, "status", "--porcelain");
    const head = gitOut(repo, "rev-parse", "HEAD");
    const board = outlined("Build");
    board.projects[0] = { id: WORKSPACE_PROJECT_ID, name: "My repo", summary: "", repo };
    const { engine, runner } = planServer(board);
    try {
      expect(await runner.handle({ command: "runPlan", goalId: board.goals[0].id })).toEqual({ ok: true });
      await runner.idle();
      const step = engine.get().tasks[0];
      expect(step.status).toBe("completed");
      expect(step.git?.branch).toBe("shepherd-step/build");
      expect(step.git?.folder).not.toBe(repo);
      expect(readFileSync(path.join(step.git!.folder, "build.txt"), "utf8")).toBe("build\n");
      expect(gitOut(repo, "rev-list", "--count", step.git!.branch)).toBe("2");
      expect(gitOut(repo, "branch", "--show-current")).toBe("my-main");
      expect(gitOut(repo, "rev-parse", "HEAD")).toBe(head);
      expect(gitOut(repo, "rev-parse", "other-work")).toBe(head);
      expect(gitOut(repo, "rev-parse", "shepherd/build")).toBe(head);
      expect(gitOut(repo, "status", "--porcelain")).toBe(status);
      expect(readFileSync(path.join(repo, "mine.txt"), "utf8")).toBe("unstaged\n");

      // A saved worktree must not let a missing project path bypass the next check or run.
      rmSync(repo, { recursive: true });
      engine.dispatch({ type: "setCheckCommand", id: step.id, command: "touch should-not-run" });
      await runner.handle({ command: "check", taskId: step.id });
      await runner.idle();
      expect(engine.get().tasks[0].verification[0].output).toContain(repo);
      expect(existsSync(path.join(step.git!.folder, "should-not-run"))).toBe(false);
      await runner.handle({ command: "run", taskId: step.id });
      await runner.idle();
      expect(engine.get().tasks[0].blocker).toContain(repo);
      expect(existsSync(repo)).toBe(false);
    } finally {
      runner.close();
      engine.close();
      rmSync(repo, { recursive: true, force: true });
    }
  }, 30_000);

  it("reruns a check that a restart cut short", async () => {
    const task = finishedTask();
    const { engine, runner } = restartWith({ ...task, verification: task.verification.map((check) => ({ ...check, running: true })) });
    await runner.idle();
    const after = engine.get().tasks[0]!;
    expect(after.verification[0]).toMatchObject({ state: "passed", running: false });
    expect(isFullyVerified(after)).toBe(true);
  });

  it("stops its checks and records nothing once closed", async () => {
    const task = { ...finishedTask(), checkCommand: "sleep 10; exit 1", autoRun: true };
    const { engine, runner } = restartWith({
      ...task,
      verification: task.verification.map((check) => ({ ...check, command: task.checkCommand, running: true })),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(engine.get().tasks[0]!.verification[0]!.running).toBe(true);
    const started = Date.now();
    runner.close();
    engine.close();
    await runner.idle();
    expect(Date.now() - started).toBeLessThan(3000);
    const after = engine.get().tasks[0]!;
    expect(after.status).toBe("completed");
    expect(after.retries).toBeUndefined();
    expect(engine.get().events.some((event) => event.message.startsWith("Retrying"))).toBe(false);
  });

  it("does not rerun a check that already finished", async () => {
    const task = finishedTask();
    const { engine, runner } = restartWith({
      ...task,
      verification: task.verification.map((check) => ({ ...check, state: "passed" as const, timestamp: 123 })),
    });
    await runner.idle();
    expect(engine.get().tasks[0]!.verification[0]).toMatchObject({ state: "passed", timestamp: 123 });
  });
});

describe("plans", () => {
  it("pushes accepted task work before the last agent, passes all reports, and saves its MR link", async () => {
    const board = outlined("Build\nReview\nMR");
    board.tasks[2]!.pushBeforeRun = true;
    const url = "https://gitlab.example.test/team/app/-/merge_requests/17";
    const source = FAKE_AGENT + `
if (name === "mr") {
  const { execFileSync } = await import("node:child_process");
  const pushed = execFileSync("git", ["ls-remote", "--exit-code", "publish", "refs/heads/" + process.env.SHEPHERD_TASK_BRANCH], { encoding: "utf8" }).trim().split(/\\s/)[0];
  const accepted = execFileSync("git", ["rev-parse", process.env.SHEPHERD_TASK_BRANCH], { encoding: "utf8" }).trim();
  if (pushed !== accepted) process.exit(1);
  for (const file of ["build.txt", "review.txt"]) execFileSync("git", ["cat-file", "-e", pushed + ":" + file]);
  say({ type: "item.completed", item: { type: "agent_message", text: "Updated the merge request.\\n${url}" } });
}
`;
    const { engine, runner, project, prompts } = planServer(board, undefined, source);
    try {
      await ensureRepo(project);
      const remote = path.join(path.dirname(project), "remote.git");
      gitOut(project, "init", "--bare", "-q", remote);
      gitOut(project, "remote", "add", "publish", remote);
      const base = gitOut(project, "branch", "--show-current");
      gitOut(project, "config", `branch.${base}.remote`, "publish");
      gitOut(project, "config", `branch.${base}.merge`, `refs/heads/${base}`);
      const initial = gitOut(project, "rev-parse", "HEAD");
      await runner.handle({ command: "runPlan", goalId: board.goals[0]!.id });
      await runner.idle();
      const goal = engine.get().goals[0]!;
      expect(engine.get().tasks.map((step) => step.status)).toEqual(["completed", "completed", "completed"]);
      const prompt = prompts().find((item) => item.name === "mr")!.prompt;
      expect(prompt).toContain(`Shepherd has pushed the task branch ${goal.branch} to remote publish. Its base branch is ${base}.`);
      expect(prompt).toContain("Report from build");
      expect(prompt).toContain("Report from review");
      expect(goal.mergeRequestUrl).toBe(url);
      expect(gitOut(remote, "for-each-ref", "--format=%(refname)")).toBe(`refs/heads/${goal.branch}`);
      expect(gitOut(project, "rev-parse", "HEAD")).toBe(initial);
      expect(gitOut(project, "status", "--porcelain")).toBe("");
    } finally { runner.close(); engine.close(); }
  }, 60_000);

  it("fails without a remote before creating branches, collecting work or starting the agent", async () => {
    const board = outlined("MR");
    board.tasks[0]!.pushBeforeRun = true;
    const { engine, runner, project, prompts } = planServer(board);
    try {
      await ensureRepo(project);
      writeFileSync(path.join(project, "mine.txt"), "mine");
      gitOut(project, "add", ".");
      const status = gitOut(project, "status", "--porcelain");
      const refs = gitOut(project, "show-ref");
      await runner.handle({ command: "runPlan", goalId: board.goals[0]!.id });
      await runner.idle();
      expect(engine.get().tasks[0]!.status).toBe("failed");
      expect(engine.get().tasks[0]!.blocker).toContain("remote origin is not available");
      expect(engine.get().tasks[0]!.git).toBeUndefined();
      expect(engine.get().goals[0]!.branch).toBeUndefined();
      expect(() => prompts()).toThrow();
      expect(gitOut(project, "status", "--porcelain")).toBe(status);
      expect(gitOut(project, "show-ref")).toBe(refs);
    } finally { runner.close(); engine.close(); }
  });

  it("does not start an agent after git rejects the push", async () => {
    const board = outlined("MR");
    board.tasks[0]!.pushBeforeRun = true;
    const { engine, runner, project, prompts } = planServer(board);
    try {
      await ensureRepo(project);
      gitOut(project, "remote", "add", "origin", path.join(path.dirname(project), "missing.git"));
      await runner.handle({ command: "runPlan", goalId: board.goals[0]!.id });
      await runner.idle();
      expect(engine.get().tasks[0]!.status).toBe("failed");
      expect(engine.get().tasks[0]!.blocker).toContain("does not appear to be a git repository");
      expect(engine.get().tasks[0]!.git).toBeUndefined();
      expect(engine.get().goals[0]!.mergeRequestUrl).toBeUndefined();
      expect(() => prompts()).toThrow();
    } finally { runner.close(); engine.close(); }
  });

  it("runs the outline in order, hands each step the work and reports before it, and stops when done", async () => {
    const { engine, runner, prompts } = planServer(outlined("Plan\n  Front\n  Back\nShip"));
    expect(await runner.handle({ command: "runPlan", projectId: WORKSPACE_PROJECT_ID })).toEqual({ ok: true });
    expect(engine.get().goals[0]!.running).toBe(true);
    await runner.idle();

    const board = engine.get();
    const step = (name: string) => board.tasks.find((task) => task.name === name)!;
    expect(board.tasks.every(isFullyVerified)).toBe(true);
    expect(board.goals[0]!.running).toBe(false);

    const order = prompts().map((item) => item.name);
    expect(order[0]).toBe("plan");
    expect(order.slice(1, 3).sort()).toEqual(["back", "front"]);
    expect(order[3]).toBe("ship");

    const said = Object.fromEntries(prompts().map((item) => [item.name, item.prompt]));
    expect(said.front).toContain("Report from plan: wrote plan.txt");
    expect(said.ship).toContain("Report from front");
    expect(said.ship).toContain("Report from back");
    expect(said.ship).not.toContain("Report from plan");

    expect(step("Plan").output).toBe("Report from plan: wrote plan.txt");
    expect(step("Ship").git?.branch).toBe("shepherd-step/ship");
    for (const file of ["plan.txt", "front.txt", "back.txt", "ship.txt"]) {
      expect(existsSync(path.join(step("Ship").git!.folder, file))).toBe(true);
    }

    expect(await runner.handle({ command: "mergePlan", projectId: WORKSPACE_PROJECT_ID })).toEqual({ ok: true });
    expect(engine.get().tasks.every((task) => task.git?.merged)).toBe(true);
    runner.close();
    engine.close();
  }, 60_000);

  it("gives a step you do a folder with the earlier work, keeps your changes, and sends problems back", async () => {
    const board = outlined("Plan\n  Front\n  Back\nTry");
    const human = { ...board, tasks: board.tasks.map((task) => (task.name === "Try" ? { ...task, runner: "human" as const, agentId: null } : task)) };
    const { engine, runner, prompts, project } = planServer(human);
    const step = (name: string) => engine.get().tasks.find((task) => task.name === name)!;
    expect(await runner.handle({ command: "runPlan", projectId: WORKSPACE_PROJECT_ID })).toEqual({ ok: true });
    await runner.idle();

    const folder = step("Try").git!.folder;
    expect(step("Try").status).toBe("queued");
    expect(step("Try").git?.branch).toBe(engine.get().goals[0].branch);
    expect(folder).toBe(engine.get().goals[0].folder);
    for (const file of ["plan.txt", "front.txt", "back.txt"]) expect(existsSync(path.join(folder, file))).toBe(true);
    expect(engine.get().goals[0]!.running).toBe(true);

    expect(await runner.handle({ command: "sendBack", taskId: step("Try").id, to: step("Front").id, text: "The button is blue" })).toEqual({
      ok: true,
    });
    await runner.idle();
    expect(prompts().filter((item) => item.name === "front")).toHaveLength(2);
    expect(prompts().at(-1)!.prompt).toContain("Try found a problem with this work: The button is blue");
    expect(step("Try").status).toBe("queued");
    expect(step("Try").outdated).toBeUndefined();

    writeFileSync(path.join(folder, "notes.txt"), "looks good\n");
    expect(await runner.handle({ command: "complete", taskId: step("Try").id })).toEqual({ ok: true });
    await runner.idle();
    expect(step("Try").filesChanged).toEqual(["notes.txt"]);
    expect(engine.get().tasks.every(isFullyVerified)).toBe(true);
    expect(engine.get().goals[0]!.running).toBe(false);

    expect(await runner.handle({ command: "mergePlan", projectId: WORKSPACE_PROJECT_ID })).toEqual({ ok: true });
    for (const file of ["plan.txt", "front.txt", "back.txt", "notes.txt"]) expect(existsSync(path.join(project, file))).toBe(true);
    runner.close();
    engine.close();
  }, 60_000);

  it("writes a checklist for a step you do once its folder is ready, but only if the step says nothing yet", async () => {
    const board = outlined("Build\nTry\nSign");
    const yours = (name: string, objective: string) => (task: Task) => (task.name === name ? { ...task, runner: "human" as const, agentId: null, objective } : task);
    const asked: { name: string; earlier: string[] }[] = [];
    const { engine, runner } = planServer({ ...board, tasks: board.tasks.map(yours("Try", "Try")).map(yours("Sign", "Sign it off")) }, async (state, task) => {
      expect(engine.get().tasks.find((item) => item.id === task.id)!.drafting).toBe(true);
      asked.push({ name: task.name, earlier: state.tasks.filter((item) => item.status === "completed").map((item) => item.name) });
      return { text: "npm start, then open http://localhost:8123\n1. Play a move." };
    });
    const step = (name: string) => engine.get().tasks.find((task) => task.name === name)!;
    expect(await runner.handle({ command: "runPlan", projectId: WORKSPACE_PROJECT_ID })).toEqual({ ok: true });
    await runner.idle();
    expect(asked).toEqual([{ name: "Try", earlier: ["Build"] }]);
    expect(step("Try").objective).toBe("npm start, then open http://localhost:8123\n1. Play a move.");
    expect(step("Try").drafting).toBeUndefined();

    expect(await runner.handle({ command: "complete", taskId: step("Try").id })).toEqual({ ok: true });
    await runner.idle();
    expect(step("Sign").git).toBeDefined();
    expect(asked).toHaveLength(1);
    expect(step("Sign").objective).toBe("Sign it off");

    expect(await runner.handle({ command: "checklist", taskId: step("Sign").id })).toEqual({ ok: true });
    expect(asked.map((item) => item.name)).toEqual(["Try", "Sign"]);
    expect(step("Sign").objective).toBe("Sign it off");
    expect(step("Sign").checklist).toBe("npm start, then open http://localhost:8123\n1. Play a move.");
    engine.dispatch({ type: "settleChecklist", id: step("Sign").id, use: true });
    expect(step("Sign").objective).toBe("npm start, then open http://localhost:8123\n1. Play a move.");
    expect(step("Sign").checklist).toBeUndefined();
    expect(await runner.handle({ command: "checklist", taskId: step("Build").id })).toEqual({ error: "An agent does Build, so its prompt is yours to write." });
    runner.close();
    engine.close();
  }, 60_000);

  it("refuses to run a plan with a step nobody can do", async () => {
    const board = outlined("Plan");
    const { runner, engine } = planServer({ ...board, tasks: board.tasks.map((task) => ({ ...task, agentId: null })) });
    expect(await runner.handle({ command: "runPlan", projectId: WORKSPACE_PROJECT_ID })).toEqual({ error: "Pick who does Plan first." });
    expect(engine.get().goals[0]!.running).toBe(false);
    runner.close();
    engine.close();
  });
});

describe("separate task plans", () => {
  it("runs and merges one task without running or merging another task's steps", async () => {
    const first = `goal-${WORKSPACE_PROJECT_ID}`;
    let board = outlined("Plan");
    board = reducer(board, { type: "createGoal", goal: { id: "second", projectId: WORKSPACE_PROJECT_ID, name: "Other task", goal: "", status: "open", running: false, outline: [] } });
    board = reducer(board, { type: "addSteps", goalId: "second", after: null, steps: [{ task: { ...newStep(WORKSPACE_PROJECT_ID, "Other", "Do Other", "agent-codex", "second"), id: "step-other" }, depth: 0 }] });
    const { runner, engine, project, prompts } = planServer(board);
    try {
      expect(await runner.handle({ command: "runPlan", goalId: first })).toEqual({ ok: true });
      await runner.idle();
      expect(engine.get().tasks.find((task) => task.goalId === first)?.status).toBe("completed");
      expect(engine.get().tasks.find((task) => task.goalId === "second")).toMatchObject({ status: "queued" });
      expect(engine.get().tasks.find((task) => task.goalId === "second")?.git).toBeUndefined();
      expect(prompts().map((item) => item.name)).toEqual(["plan"]);
      expect(await runner.handle({ command: "runPlan", goalId: "second" })).toEqual({ ok: true });
      await runner.idle();
      expect(await runner.handle({ command: "mergePlan", goalId: first })).toEqual({ ok: true });
      expect(existsSync(path.join(project, "plan.txt"))).toBe(true);
      expect(existsSync(path.join(project, "other.txt"))).toBe(false);
      expect(engine.get().tasks.find((task) => task.goalId === "second")?.git?.merged?.into).toBe(engine.get().goals.find((goal) => goal.id === "second")?.branch);
      expect(await runner.handle({ command: "mergePlan", goalId: "second" })).toEqual({ ok: true });
      expect(existsSync(path.join(project, "other.txt"))).toBe(true);
    } finally {
      runner.close();
      engine.close();
    }
  });

  it("stops only the selected task's running flag", async () => {
    const board = reducer(outlined("Plan"), { type: "createGoal", goal: { id: "second", projectId: WORKSPACE_PROJECT_ID, name: "Other", goal: "", status: "open", running: false } });
    const { runner, engine } = planServer(board);
    try {
      engine.dispatch({ type: "setPlanRunning", goalId: board.goals[0]!.id, running: true });
      engine.dispatch({ type: "setPlanRunning", goalId: "second", running: true });
      expect(await runner.handle({ command: "stopPlan", goalId: "second" })).toEqual({ ok: true });
      expect(engine.get().goals.map((goal) => goal.running)).toEqual([true, false]);
    } finally {
      runner.close();
      engine.close();
    }
  });
});

describe("task work collection", () => {
  it("waits for acceptance and a clean task folder, then automatically merges and starts from person commits", async () => {
    const board = outlined("Build\nNext");
    board.tasks[0].verification = [{ id: "review-build", kind: "review", state: "pending", timestamp: null, evidence: "" }];
    const { engine, runner, project, prompts } = planServer(board);
    try {
      await runner.handle({ command: "runPlan", goalId: board.goals[0].id });
      await runner.idle();
      const goal = engine.get().goals[0];
      const first = () => engine.get().tasks[0];
      expect(first().status).toBe("completed");
      expect(first().git?.merged).toBeUndefined();
      expect(existsSync(path.join(goal.folder!, "build.txt"))).toBe(false);
      const projectHead = gitOut(project, "rev-parse", "HEAD");
      writeFileSync(path.join(goal.folder!, "person.txt"), "starting point\n");
      gitOut(goal.folder!, "add", ".");
      gitOut(goal.folder!, "commit", "-qm", "My own task commit");
      writeFileSync(path.join(goal.folder!, "person.txt"), "my change\n");
      engine.dispatch({ type: "setCheck", taskId: first().id, checkId: "review-build", state: "passed" });
      await runner.idle();
      expect(first().blocker).toContain("Commit or stash");
      expect(engine.timelines.read(first().id).entries.filter((entry) => entry.kind === "wait")).toMatchObject([{ text: expect.stringContaining("uncommitted changes") }]);
      expect(engine.get().goals[0].blocker).toBe(first().blocker);
      expect(first().git?.merged).toBeUndefined();
      expect(engine.get().tasks[1].status).toBe("queued");
      expect(existsSync(path.join(goal.folder!, "build.txt"))).toBe(false);
      expect(readFileSync(path.join(goal.folder!, "person.txt"), "utf8")).toBe("my change\n");
      gitOut(goal.folder!, "add", ".");
      gitOut(goal.folder!, "commit", "-qm", "Keep my change");
      // Git changes do not dispatch a board action: the runner must notice on its own.
      await expect.poll(() => engine.get().tasks.every((step) => isFullyVerified(step) && step.git?.merged), { timeout: 15000 }).toBe(true);
      await runner.idle();
      expect(engine.get().goals[0].blocker).toBeNull();
      expect(first().blocker).toBeNull();
      const next = engine.get().tasks[1];
      expect(readFileSync(path.join(next.git!.folder, "person.txt"), "utf8")).toBe("my change\n");
      for (const file of ["build.txt", "next.txt", "person.txt"]) expect(existsSync(path.join(goal.folder!, file))).toBe(true);
      expect(gitOut(project, "rev-parse", "HEAD")).toBe(projectHead);
      expect(gitOut(project, "status", "--porcelain")).toBe("");
      expect(existsSync(path.join(project, "build.txt"))).toBe(false);
      const prompt = prompts().find((item) => item.name === "next")!;
      expect(prompt.prompt).toContain(`task branch ${goal.branch}`);
      expect(prompt.env).toEqual({ branch: goal.branch, folder: goal.folder, base: goal.base });
    } finally { runner.close(); engine.close(); }
  }, 30_000);

  it("does not collect a step with a failed command check", async () => {
    const board = outlined("Build");
    board.tasks[0] = { ...board.tasks[0], checkCommand: "exit 1", verification: [{ id: "command-build", kind: "command", state: "pending", timestamp: null, evidence: "", command: "exit 1" }] };
    const { engine, runner } = planServer(board);
    try {
      await runner.handle({ command: "run", taskId: board.tasks[0].id });
      await runner.idle();
      expect(engine.get().tasks[0].status).toBe("failed");
      expect(engine.get().tasks[0].git?.merged).toBeUndefined();
      expect(existsSync(path.join(engine.get().goals[0].folder!, "build.txt"))).toBe(false);
    } finally { runner.close(); engine.close(); }
  });

  it("gives a first human step the task folder and commits it on the task branch", async () => {
    const board = outlined("Try\nNext");
    board.tasks[0] = { ...board.tasks[0], runner: "human", agentId: null };
    const { engine, runner, project } = planServer(board);
    try {
      await runner.handle({ command: "runPlan", goalId: board.goals[0].id });
      await runner.idle();
      const goal = engine.get().goals[0];
      expect(engine.get().tasks[0].git?.folder).toBe(goal.folder);
      expect(engine.get().tasks[0].git?.branch).toBe(goal.branch);
      const initial = gitOut(project, "rev-parse", "HEAD");
      gitOut(project, "config", "user.name", "Person");
      gitOut(project, "config", "user.email", "person@example.test");
      writeFileSync(path.join(goal.folder!, "human.txt"), "my work\n");
      expect(await runner.handle({ command: "complete", taskId: board.tasks[0].id })).toEqual({ ok: true });
      await runner.idle();
      expect(engine.get().tasks.every(isFullyVerified)).toBe(true);
      expect(engine.get().tasks[0].filesChanged).toEqual(["human.txt"]);
      expect(gitOut(goal.folder!, "log", "--format=%s|%an")).toContain("Try|Person");
      expect(readFileSync(path.join(engine.get().tasks[1].git!.folder, "human.txt"), "utf8")).toBe("my work\n");
      expect(gitOut(project, "rev-parse", "HEAD")).toBe(initial);
      expect(existsSync(path.join(project, "human.txt"))).toBe(false);
    } finally { runner.close(); engine.close(); }
  });

  it("collects a migrated finished step without renaming its branch or running it again", async () => {
    const repo = mkdtempSync(path.join(tmpdir(), "shepherd-legacy-"));
    const root = mkdtempSync(path.join(tmpdir(), "shepherd-legacy-trees-"));
    await ensureRepo(repo);
    const old = await openWorktree(repo, root, "step-build", "old-build");
    writeFileSync(path.join(old.folder, "build.txt"), "old work\n");
    await commitAll(old.folder, ["Finished before tasks existed"], { name: "Codex", email: "codex@test" });
    const board = outlined("Build\nNext");
    board.projects[0] = { ...board.projects[0], repo };
    board.tasks[0] = { ...board.tasks[0], status: "completed", git: { branch: old.branch, folder: old.folder, target: old.target } };
    const legacy = { ...board, schema: 2, goals: undefined } as unknown as OrchestrationState;
    const { engine, runner, prompts } = planServer(legacy);
    try {
      expect(engine.get().goals[0].branch).toBeUndefined();
      expect(engine.get().tasks[0].git?.branch).toBe(old.branch);
      await runner.handle({ command: "runPlan", goalId: board.goals[0].id });
      await runner.idle();
      const goal = engine.get().goals[0];
      expect(goal.branch).toMatch(/^shepherd\//);
      expect(readFileSync(path.join(goal.folder!, "build.txt"), "utf8")).toBe("old work\n");
      expect(engine.get().tasks[0].git?.branch).toBe(old.branch);
      expect(engine.get().tasks[0].git?.folder).toBe(old.folder);
      expect(engine.get().tasks[0].git?.merged?.into).toBe(goal.branch);
      expect(prompts().map((item) => item.name)).toEqual(["next"]);
      expect(readFileSync(path.join(engine.get().tasks[1].git!.folder, "build.txt"), "utf8")).toBe("old work\n");
      expect(existsSync(path.join(repo, "build.txt"))).toBe(false);
    } finally {
      runner.close(); engine.close();
      rmSync(repo, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("merges only into the task's recorded base when explicitly asked", async () => {
    const board = outlined("Build");
    const { engine, runner, project } = planServer(board);
    try {
      await runner.handle({ command: "runPlan", goalId: board.goals[0].id });
      await runner.idle();
      const goal = engine.get().goals[0];
      gitOut(project, "checkout", "-qb", "another-branch");
      const before = gitOut(project, "rev-parse", "HEAD");
      expect(await runner.handle({ command: "mergePlan", goalId: goal.id })).toEqual({ error: expect.stringContaining(`no longer on ${goal.base}`) });
      expect(gitOut(project, "rev-parse", "HEAD")).toBe(before);
      expect(existsSync(path.join(project, "build.txt"))).toBe(false);
      gitOut(project, "checkout", "-q", goal.base!);
      expect(await runner.handle({ command: "mergePlan", goalId: goal.id })).toEqual({ ok: true });
      expect(existsSync(path.join(project, "build.txt"))).toBe(true);
      expect(engine.get().goals[0].merged?.into).toBe(goal.base);
    } finally { runner.close(); engine.close(); }
  });
});
