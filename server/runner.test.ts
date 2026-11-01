import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blankTask, newStep } from "../src/model/factory";
import { reducer } from "../src/model/reducer";
import type { OrchestrationState, Task } from "../src/model/types";
import { isFullyVerified } from "../src/model/verify";
import { WORKSPACE_PROJECT_ID, workspace } from "../src/model/workspace";
import { createEngine, envelope } from "./engine";
import { createRunner } from "./runner";

/** Stands in for Codex: writes a file named after its step, then reports like Codex does. */
const FAKE_AGENT = `
import { appendFileSync, writeFileSync } from "node:fs";
const [log, prompt] = process.argv.slice(2);
const name = /Objective: Do (\\w+)/.exec(prompt)[1].toLowerCase();
writeFileSync(name + ".txt", name + "\\n");
appendFileSync(log, JSON.stringify({ name, prompt }) + "\\n");
const say = (event) => console.log(JSON.stringify(event));
say({ type: "thread.started", thread_id: "thread-" + name });
say({ type: "item.completed", item: { type: "agent_message", text: "Report from " + name + ": wrote " + name + ".txt" } });
say({ type: "turn.completed" });
`;

function planServer(board: OrchestrationState) {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-plan-"));
  const sandbox = path.join(root, "sandbox");
  mkdirSync(path.join(sandbox, "workspace"), { recursive: true });
  const agent = path.join(root, "agent.mjs");
  const log = path.join(root, "prompts.jsonl");
  writeFileSync(agent, FAKE_AGENT);
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
  });
  const prompts = () =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { name: string; prompt: string });
  return { engine, runner, prompts, project: path.join(sandbox, "workspace") };
}

function outlined(spec: string): OrchestrationState {
  const steps = spec.split("\n").map((line) => {
    const name = line.trim();
    return { task: { ...newStep(WORKSPACE_PROJECT_ID, name, `Do ${name}`), id: `step-${name.toLowerCase()}` }, depth: (line.length - line.trimStart().length) / 2 };
  });
  return reducer(workspace(0), { type: "addSteps", projectId: WORKSPACE_PROJECT_ID, after: null, steps });
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
  it("runs the outline in order, hands each step the work and reports before it, and stops when done", async () => {
    const { engine, runner, prompts } = planServer(outlined("Plan\n  Front\n  Back\nShip"));
    expect(await runner.handle({ command: "runPlan", projectId: WORKSPACE_PROJECT_ID })).toEqual({ ok: true });
    expect(engine.get().projects[0]!.running).toBe(true);
    await runner.idle();

    const board = engine.get();
    const step = (name: string) => board.tasks.find((task) => task.name === name)!;
    expect(board.tasks.every(isFullyVerified)).toBe(true);
    expect(board.projects[0]!.running).toBeUndefined();

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
    expect(step("Ship").git?.branch).toBe("shepherd/ship");
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
    expect(step("Try").git?.branch).toBe("shepherd/try");
    for (const file of ["plan.txt", "front.txt", "back.txt"]) expect(existsSync(path.join(folder, file))).toBe(true);
    expect(engine.get().projects[0]!.running).toBe(true);

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
    expect(engine.get().projects[0]!.running).toBeUndefined();

    expect(await runner.handle({ command: "mergePlan", projectId: WORKSPACE_PROJECT_ID })).toEqual({ ok: true });
    for (const file of ["plan.txt", "front.txt", "back.txt", "notes.txt"]) expect(existsSync(path.join(project, file))).toBe(true);
    runner.close();
    engine.close();
  }, 60_000);

  it("refuses to run a plan with a step nobody can do", async () => {
    const board = outlined("Plan");
    const { runner, engine } = planServer({ ...board, tasks: board.tasks.map((task) => ({ ...task, agentId: null })) });
    expect(await runner.handle({ command: "runPlan", projectId: WORKSPACE_PROJECT_ID })).toEqual({ error: "Pick who does Plan first." });
    expect(engine.get().projects[0]!.running).toBeUndefined();
    runner.close();
    engine.close();
  });
});
