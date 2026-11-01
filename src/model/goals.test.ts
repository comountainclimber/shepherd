import { describe, expect, it } from "vitest";
import { blankGoal, newStep } from "./factory";
import { resolveGoal } from "./goals";
import { outlineOf } from "./outline";
import { reducer } from "./reducer";
import { tasksForGoal } from "./selectors";
import { workspace, WORKSPACE_PROJECT_ID as P } from "./workspace";

const G = `goal-${P}`;

function board() {
  return reducer(workspace(1), { type: "createGoal", goal: blankGoal(P, "Second task", "second", "Make it faster") });
}

function add(state = board(), goalId = G, name = "Build") {
  const task = { ...newStep(P, name, "", "agent-codex", goalId), id: `${goalId}-${name}` };
  return reducer(state, { type: "addSteps", goalId, after: outlineOf(state, goalId).at(-1)?.id ?? null, steps: [{ task, depth: 0 }] });
}

describe("tasks between projects and steps", () => {
  it("creates and edits a task without accepting run or git state from its creator", () => {
    const state = reducer(workspace(1), { type: "createGoal", goal: { ...blankGoal(P, "  Timeout  ", "new", "Fix it"), running: true, branch: "other", status: "archived" } });
    expect(state.goals.at(-1)).toEqual(blankGoal(P, "Timeout", "new", "Fix it"));
    const edited = reducer(state, { type: "updateGoal", id: "new", patch: { name: " Fix timeout ", goal: " Keep it fast " } });
    expect(edited.goals.at(-1)).toMatchObject({ name: "Fix timeout", goal: "Keep it fast" });
    expect(reducer(edited, { type: "createGoal", goal: blankGoal(P, "Duplicate", "new") })).toBe(edited);
    expect(reducer(edited, { type: "createGoal", goal: blankGoal("missing", "No project", "no") })).toBe(edited);
  });

  it("keeps outlines, layouts, selectors and running flags separate", () => {
    let state = add(add(add(board()), "second", "Other"), G, "Test");
    state = reducer(state, { type: "setOutline", goalId: G, items: [{ id: `${G}-Build`, depth: 0 }, { id: `${G}-Test`, depth: 1 }, { id: "second-Other", depth: 0 }] });
    expect(outlineOf(state, G)).toEqual([{ id: `${G}-Build`, depth: 0 }, { id: `${G}-Test`, depth: 1 }]);
    expect(outlineOf(state, "second")).toEqual([{ id: "second-Other", depth: 0 }]);
    expect(tasksForGoal(state, "second").map((task) => task.id)).toEqual(["second-Other"]);
    expect(state.dependencies).toEqual([{ id: `${G}-Build->${G}-Test`, source: `${G}-Build`, target: `${G}-Test`, gate: "verified", outline: true }]);
    state = reducer(state, { type: "setPlanRunning", goalId: G, running: true });
    expect(state.goals.map((goal) => goal.running)).toEqual([true, false]);
    state = reducer(state, { type: "setPlanRunning", goalId: "second", running: true });
    state = reducer(state, { type: "setPlanRunning", goalId: G, running: false });
    expect(state.goals.map((goal) => goal.running)).toEqual([false, true]);
  });

  it("finishes, archives and reopens tasks and clears their running flag", () => {
    let state = reducer(board(), { type: "setPlanRunning", goalId: G, running: true });
    state = reducer(state, { type: "finishGoal", id: G });
    expect(state.goals[0]).toMatchObject({ status: "done", running: false });
    expect(reducer(state, { type: "setPlanRunning", goalId: G, running: true })).toBe(state);
    state = reducer(state, { type: "archiveGoal", id: G });
    expect(state.goals[0]?.status).toBe("archived");
    state = reducer(state, { type: "reopenGoal", id: G });
    expect(state.goals[0]).toMatchObject({ status: "open", running: false });
    expect(state.goals[1]?.status).toBe("open");
  });

  it("deletes a task's steps and arrows, leaving the other task and project", () => {
    const state = add(add(add(board()), G, "Test"), "second", "Other");
    const next = reducer(state, { type: "deleteGoal", id: G });
    expect(next.goals.map((goal) => goal.id)).toEqual(["second"]);
    expect(next.tasks.map((task) => task.id)).toEqual(["second-Other"]);
    expect(next.dependencies).toEqual([]);
    expect(next.projects).toEqual(state.projects);
  });

  it("refuses steps and arrows that belong to another task", () => {
    const state = add(add(board()), "second", "Other");
    expect(reducer(state, { type: "connect", source: `${G}-Build`, target: "second-Other" })).toBe(state);
    const task = newStep(P, "Wrong task", "", "agent-codex", "second");
    expect(reducer(state, { type: "addSteps", goalId: G, after: null, steps: [{ task, depth: 0 }] })).toBe(state);
    const next = reducer(state, { type: "updateTask", id: `${G}-Build`, patch: { goalId: "second" } });
    expect(next.tasks[0]?.goalId).toBe(G);
  });
});

describe("task selection for outside callers", () => {
  it("requires a task when a project has several open tasks, and lists the choices", () => {
    expect(resolveGoal(board(), undefined, P)).toEqual({ error: expect.stringMatching(/several open tasks.*Workspace.*Second task/) });
    expect(resolveGoal(board(), "second")).toMatchObject({ id: "second" });
    expect(resolveGoal(board(), "second TASK", "Workspace")).toMatchObject({ id: "second" });
  });

  it("uses the only open task and refuses projects with none", () => {
    const state = reducer(board(), { type: "finishGoal", id: G });
    expect(resolveGoal(state, undefined, P)).toMatchObject({ id: "second" });
    const none = reducer(state, { type: "archiveGoal", id: "second" });
    expect(resolveGoal(none, undefined, P)).toEqual({ error: expect.stringContaining("no open tasks") });
  });

  it("requires ids for duplicate names and refuses a task in another project", () => {
    let state = reducer(board(), { type: "updateGoal", id: G, patch: { name: "Second task" } });
    expect(resolveGoal(state, "Second task")).toEqual({ error: expect.stringContaining("Use its goal id") });
    state = reducer(state, { type: "createProject", project: { id: "other", name: "Other", summary: "" } });
    expect(resolveGoal(state, "second", "other")).toEqual({ error: "There is no task second." });
  });
});
