import { expect, it } from "vitest";
import { blankTask, workCheck } from "./factory";
import { acceptanceItems } from "./acceptance";
import { tabAction } from "../../server/engine";
import { loadState, interruptWork } from "./migrate";
import { reducer } from "./reducer";
import { fromSaved, readSavedSteps, toSavedItem } from "./savedSteps";
import { workspace, WORKSPACE_PROJECT_ID } from "./workspace";
import { isFullyVerified } from "./verify";
import type { OrchestrationState, WorkCheckResult } from "./types";

const task = blankTask({ id: "step", projectId: WORKSPACE_PROJECT_ID, name: "Build", objective: "Build it", acceptance: ["Page loads"], agentId: "agent-codex", position: { x: 0, y: 0 }, workCheck: true });
const result: WorkCheckResult = { items: [{ key: acceptanceItems(task.acceptance)[0].key, item: 1, verdict: "can't tell", reason: "No page evidence" }], unrequested: ["Updated formatting"], violations: [] };
const board = (): OrchestrationState => ({ ...workspace(0), tasks: [{ ...task, status: "completed" }] });

it("is off by default, is agent-only, and keeps the option but no verdicts in saved steps", () => {
  const plain = blankTask({ ...task, workCheck: false });
  expect(plain.verification).toEqual([]);
  expect(blankTask({ ...task, runner: "human", workCheck: true }).verification).toEqual([]);
  const saved = readSavedSteps([{ id: "saved", name: "Build", steps: [toSavedItem(task, 0)] }])[0];
  expect(saved.steps[0].workCheck).toBe(true);
  const copy = fromSaved(saved, WORKSPACE_PROJECT_ID, 0, null, () => "copy").steps[0].task;
  expect(copy.verification).toEqual([workCheck("copy")]);
});

it("keeps current verdicts on reload and restarts an interrupted check as pending", () => {
  let state = reducer(board(), { type: "startWorkCheck", taskId: task.id });
  expect(interruptWork(state).tasks[0].verification[0]).toMatchObject({ running: false, state: "pending" });
  state = reducer(state, { type: "recordWorkCheck", taskId: task.id, result });
  const loaded = loadState(state);
  expect(loaded?.tasks[0].verification[0]).toMatchObject({ state: "passed", result });
  expect(isFullyVerified(state.tasks[0])).toBe(true);
});

it("fails unmet items, violations and unusable replies and preserves reasons for retry", () => {
  for (const failure of [
    { result: { ...result, items: result.items.map((item) => ({ ...item, verdict: "not met" as const })) } },
    { result: { ...result, violations: ["Deleted the file the step said to keep"] } },
    { failure: "Codex returned no answer" },
  ]) {
    let state = reducer(board(), { type: "startWorkCheck", taskId: task.id });
    state = reducer(state, { type: "recordWorkCheck", taskId: task.id, ...failure });
    expect(state.tasks[0].status).toBe("failed");
    expect(isFullyVerified(state.tasks[0])).toBe(false);
    expect(state.tasks[0].verification[0].state).toBe("failed");
  }
});

it("waits for command success, invalidates edited requests and refuses client verdicts", () => {
  const state = board();
  const withCommand = reducer(state, { type: "setCheckCommand", id: task.id, command: "npm test" });
  expect(reducer(withCommand, { type: "startWorkCheck", taskId: task.id })).toBe(withCommand);
  let done = reducer(state, { type: "startWorkCheck", taskId: task.id });
  done = reducer(done, { type: "recordWorkCheck", taskId: task.id, result });
  for (const patch of [{ acceptance: ["Changed item"] }, { objective: "Do something else" }, { description: "Another constraint" }]) {
    const edited = reducer(done, { type: "updateTask", id: task.id, patch });
    expect(edited.tasks[0].verification[0]).toEqual(workCheck(task.id));
    expect(isFullyVerified(edited.tasks[0])).toBe(false);
  }
  const instructed = reducer(done, { type: "instruct", id: task.id, text: "Also keep the old URL" });
  expect(instructed.tasks[0].verification[0]).toEqual(workCheck(task.id));
  const failed = reducer(reducer(state, { type: "startWorkCheck", taskId: task.id }), { type: "recordWorkCheck", taskId: task.id, result: { ...result, violations: ["Changed the API"] } });
  const retry = reducer(failed, { type: "instruct", id: task.id, text: "Fix it" });
  expect(retry.tasks[0].verification[0].result?.violations).toEqual(["Changed the API"]);
  expect(tabAction(state, { type: "recordWorkCheck", taskId: task.id, result })).toHaveProperty("error");
  expect(tabAction(state, { type: "setCheck", taskId: task.id, checkId: `${task.id}-work`, state: "passed" })).toHaveProperty("error");
  expect(tabAction(state, { type: "setWorkCheck", id: task.id, on: "yes" })).toHaveProperty("error");
});
