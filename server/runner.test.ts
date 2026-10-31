import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blankTask } from "../src/model/factory";
import type { Task } from "../src/model/types";
import { isFullyVerified } from "../src/model/verify";
import { WORKSPACE_PROJECT_ID, workspace } from "../src/model/workspace";
import { createEngine, envelope } from "./engine";
import { createRunner } from "./runner";

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
