import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { blankTask } from "../src/model/factory";
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
  it("allows task lifecycle edits but refuses moving or starting a step by editing its task", () => {
    const board = workspace(1);
    for (const type of ["finishGoal", "archiveGoal", "reopenGoal", "deleteGoal"]) {
      expect(tabAction(board, { type, id: board.goals[0]!.id })).toEqual({ type, id: board.goals[0]!.id });
    }
    expect(tabAction(board, { type: "updateGoal", id: "x", patch: { branch: "main", running: true } })).toHaveProperty("error");
    expect(tabAction(board, { type: "updateTask", id: "x", patch: { goalId: "other" } })).toHaveProperty("error");
  });
});
