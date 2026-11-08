import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blankGoal, blankTask } from "../src/model/factory";
import { workspace } from "../src/model/workspace";
import { createEngine, tabAction } from "./engine";

it("keeps the exact old board beside the migrated file before writing, including on restart", () => {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-migration-"));
  const file = path.join(root, "state.json");
  const old = { ...workspace(1), schema: 2, goals: undefined,
    projects: [{ id: "proj-local", name: "Workspace", summary: "", directory: "workspace", running: true, outline: [{ id: "old", depth: 0 }] }],
    tasks: [{ ...blankTask({ id: "old", projectId: "proj-local", name: "Existing", objective: "", agentId: "agent-codex", position: { x: 0, y: 0 } }),
      goalId: undefined, git: { branch: "shepherd/original", folder: "/tmp/original", target: "main" } }],
  };
  const bytes = JSON.stringify({ version: 2, state: { state: old } }, null, 2);
  writeFileSync(file, bytes);
  const engine = createEngine(file);
  expect(readFileSync(path.join(root, "state.pre-tasks.json"), "utf8")).toBe(bytes);
  expect(engine.get().goals[0]).toMatchObject({ name: "Workspace", running: true, outline: [{ id: "old", depth: 0 }] });
  expect(engine.get().tasks[0]).toMatchObject({ goalId: "goal-proj-local", git: old.tasks[0]!.git });
  expect(JSON.parse(readFileSync(file, "utf8")).state.state.schema).toBe(3);
  engine.close();
  const restarted = createEngine(file);
  expect(restarted.get().goals).toHaveLength(1);
  expect(readFileSync(path.join(root, "state.pre-tasks.json"), "utf8")).toBe(bytes);
  restarted.close();
});

describe("task actions from tabs", () => {
  it("keeps a late check with the run that started it and records review results", () => {
    const root = mkdtempSync(path.join(tmpdir(), "shepherd-check-timeline-"));
    const engine = createEngine(path.join(root, "state.json"));
    const task = blankTask({ id: "step", projectId: "proj-local", name: "Build", objective: "", agentId: "agent-codex", position: { x: 0, y: 0 }, checkCommand: "npm test", review: true });
    engine.dispatch({ type: "createTask", task });
    const first = engine.timelines.append(task.id, { kind: "run_started", text: "Started" });
    engine.dispatch({ type: "startCheck", taskId: task.id });
    engine.timelines.append(task.id, { kind: "run_started", text: "Resumed" });
    engine.dispatch({ type: "recordCheck", taskId: task.id, run: { command: "npm test", exitCode: 1, output: "Failed test", durationMs: 30 } });
    expect(engine.timelines.read(task.id).entries.at(-1)).toMatchObject({ kind: "check_ended", run: first.run, ok: false, detail: "Failed test" });
    const review = task.verification.find((check) => check.kind === "review")!;
    engine.dispatch({ type: "setCheck", taskId: task.id, checkId: review.id, state: "passed" });
    expect(engine.timelines.read(task.id).entries.at(-1)).toMatchObject({ kind: "check_ended", ok: true, text: "Your review: Passed" });
    engine.close();
  });

  it("ends interrupted timelines on restart without putting them on the board, and deletes them with their task", () => {
    const root = mkdtempSync(path.join(tmpdir(), "shepherd-timeline-engine-"));
    const file = path.join(root, "state.json");
    const engine = createEngine(file);
    const task = blankTask({ id: "step", projectId: "proj-local", name: "Build", objective: "", agentId: "agent-codex", position: { x: 0, y: 0 } });
    engine.dispatch({ type: "createTask", task });
    engine.timelines.append(task.id, { kind: "run_started", text: "Started" });
    engine.timelines.append(task.id, { kind: "note", text: "A note only in the timeline" });
    engine.close();
    const fresh = createEngine(file);
    expect(fresh.timelines.read(task.id).entries.at(-1)).toMatchObject({ kind: "run_ended", outcome: "stopped", text: "Stopped: Shepherd restarted" });
    expect(readFileSync(file, "utf8")).not.toContain("A note only in the timeline");
    fresh.dispatch({ type: "deleteGoal", id: task.goalId });
    expect(existsSync(path.join(root, "timelines", "step.jsonl"))).toBe(false);
    fresh.close();
  });

  it("allows task lifecycle edits but refuses moving or starting a step by editing its task", () => {
    const board = workspace(1);
    for (const type of ["finishGoal", "archiveGoal", "reopenGoal", "deleteGoal"]) {
      expect(tabAction(board, { type, id: board.goals[0]!.id })).toEqual({ type, id: board.goals[0]!.id });
    }
    expect(tabAction(board, { type: "updateGoal", id: "x", patch: { branch: "main", running: true } })).toHaveProperty("error");
    expect(tabAction(board, { type: "updateTask", id: "x", patch: { goalId: "other" } })).toHaveProperty("error");
    expect(tabAction(board, { type: "goalRuntime", id: "x", patch: { branch: "main" } })).toHaveProperty("error");
    expect(tabAction(board, { type: "createGoal", goal: { ...blankGoal(board.projects[0].id, "Fake"), branch: "main", folder: "/tmp/fake" } })).toHaveProperty("error");
    expect(tabAction(board, { type: "updateTask", id: "x", patch: { pushBeforeRun: true } })).toEqual({ type: "updateTask", id: "x", patch: { pushBeforeRun: true } });
    expect(tabAction(board, { type: "updateTask", id: "x", patch: { pushBeforeRun: "yes" } })).toHaveProperty("error");
    expect(tabAction(board, { type: "updateGoal", id: "x", patch: { mergeRequestUrl: "https://github.com/o/r/pull/1" } })).toHaveProperty("error");
  });

  it("lets a tab organise objectives and graphs, with palette colours only", () => {
    const board = workspace(1);
    const projectId = board.projects[0]!.id;
    const objective = board.objectives[0]!;
    expect(tabAction(board, { type: "createObjective", objective: { id: "o", projectId, name: "Dark mode" } })).not.toHaveProperty("error");
    expect(tabAction(board, { type: "createObjective", objective: { id: "o", projectId: "missing", name: "Dark mode" } })).toHaveProperty("error");
    expect(tabAction(board, { type: "updateObjective", id: objective.id, patch: { name: "" } })).toHaveProperty("error");
    expect(tabAction(board, { type: "archiveObjective", id: objective.id })).not.toHaveProperty("error");
    expect(tabAction(board, { type: "moveGoal", id: "x", by: 2 })).toHaveProperty("error");
    expect(tabAction(board, { type: "updateGoal", id: "x", patch: { color: "#4fb3f6" } })).not.toHaveProperty("error");
    expect(tabAction(board, { type: "updateGoal", id: "x", patch: { color: "red" } })).toHaveProperty("error");
    expect(tabAction(board, { type: "createGoal", goal: { ...blankGoal(projectId, "Graph", "g"), objectiveId: "missing" } })).toHaveProperty("error");
    expect(tabAction(board, { type: "createGoal", goal: { ...blankGoal(projectId, "Graph", "g"), objectiveId: objective.id, color: "#4fb3f6" } })).not.toHaveProperty("error");
  });
});
