import { describe, expect, it } from "vitest";
import { outlineOf, parseList } from "../src/model/outline";
import { reducer } from "../src/model/reducer";
import type { OrchestrationState } from "../src/model/types";
import { workspace } from "../src/model/workspace";
import { boardSummary, planProject, planTasks } from "./intake";

function board(): OrchestrationState {
  return reducer(workspace(1), { type: "createProject", project: { id: "proj-2", name: "Greeter", summary: "", directory: "greeter" } });
}

const ids = (index: number) => `api-${index + 1}`;

function planned(state: OrchestrationState, body: unknown) {
  const result = planTasks(state, body, ids);
  if ("error" in result) throw new Error(result.error);
  return result;
}

function apply(state: OrchestrationState, body: unknown) {
  return planned(state, body).actions.reduce(reducer, state);
}

describe("planTasks", () => {
  it("adds tasks the way the outline does, with no review unless asked", () => {
    const state = apply(board(), {
      project: "greeter",
      tasks: [
        { name: "Greet module", objective: "Write greet.mjs", checkCommand: "node check.mjs", acceptance: ["Exports greet", " "] },
        { name: "Shout CLI", agent: "claude", dependsOn: ["greet module"] },
        { name: "Review copy", runner: "human", dependsOn: [{ task: "Shout CLI", gate: "completed" }] },
      ],
    });
    const [greet, shout, review] = state.tasks;
    expect(greet).toMatchObject({ id: "api-1", projectId: "proj-2", worktree: "greet-module", agentId: "agent-codex", checkCommand: "node check.mjs" });
    expect(greet!.acceptance).toEqual(["Exports greet"]);
    expect(greet!.verification.map((check) => check.kind)).toEqual(["command"]);
    expect(shout!.verification).toEqual([]);
    expect(shout).toMatchObject({ objective: "Shout CLI", agentId: "agent-claude" });
    expect(review).toMatchObject({ runner: "human", agentId: null });
    expect(state.dependencies.map((dep) => [dep.source, dep.target, dep.gate])).toEqual([
      ["api-1", "api-2", "verified"],
      ["api-2", "api-3", "completed"],
    ]);
    expect(shout!.position.x).toBeGreaterThan(greet!.position.x);
  });

  it("takes a single task and gives it a free worktree name", () => {
    const once = apply(board(), { project: "proj-2", name: "Greet module" });
    const twice = planned(once, { project: "proj-2", name: "Greet module" });
    expect(twice.actions[0]).toMatchObject({ type: "addSteps", after: "api-1", steps: [{ task: { worktree: "greet-module-2" }, depth: 0 }] });
  });

  it("adds nested steps with the same arrows and layout as an outline typed in the app", () => {
    const initial = board();
    const items = parseList("Prepare\n  Build\n    Unit tests\n    Integration tests\n  Write docs\nFinish");
    const result = planned(initial, { project: "Greeter", tasks: items });
    const state = result.actions.reduce(reducer, initial);
    const goalId = result.goalId;
    const typed = reducer(initial, {
      type: "addSteps", goalId, after: null,
      steps: state.tasks.map((task, index) => ({ task, depth: items[index]!.depth })),
    });
    expect(result.actions.every((action) => action.type === "addSteps")).toBe(true);
    expect(outlineOf(state, goalId)).toEqual(items.map((item, index) => ({ id: ids(index), depth: item.depth })));
    expect(state.dependencies).toEqual(typed.dependencies);
    expect(state.tasks.map((task) => task.position)).toEqual(typed.tasks.map((task) => task.position));
    expect(state.dependencies.map((dep) => [dep.source, dep.target, dep.outline])).toEqual([
      ["api-1", "api-2", true],
      ["api-2", "api-3", true],
      ["api-2", "api-4", true],
      ["api-1", "api-5", true],
      ["api-3", "api-6", true],
      ["api-4", "api-6", true],
      ["api-5", "api-6", true],
    ]);
  });

  it("appends single steps after the last outline step, with depth defaulting to zero", () => {
    const initial = apply(board(), { project: "Greeter", tasks: [{ name: "A" }, { name: "B" }, { name: "C" }] });
    const goalId = initial.tasks[0]!.goalId;
    const ordered = reducer(initial, { type: "setOutline", goalId, items: [
      { id: "api-3", depth: 0 }, { id: "api-1", depth: 1 }, { id: "api-2", depth: 1 },
    ] });
    const nested = planTasks(ordered, { goal: goalId, name: "D", depth: 1 }, () => "nested");
    if ("error" in nested) throw new Error(nested.error);
    expect(nested.actions[0]).toMatchObject({ type: "addSteps", after: "api-2", steps: [{ depth: 1 }] });
    const withNested = nested.actions.reduce(reducer, ordered);
    const final = planTasks(withNested, { goal: goalId, name: "E" }, () => "final");
    if ("error" in final) throw new Error(final.error);
    const state = final.actions.reduce(reducer, withNested);
    expect(outlineOf(state, goalId)).toEqual([
      { id: "api-3", depth: 0 }, { id: "api-1", depth: 1 }, { id: "api-2", depth: 1 },
      { id: "nested", depth: 1 }, { id: "final", depth: 0 },
    ]);
    expect(state.dependencies.filter((dep) => dep.target === "nested").map((dep) => dep.source)).toEqual(["api-3"]);
    expect(state.dependencies.filter((dep) => dep.target === "final").map((dep) => dep.source)).toEqual(["api-1", "api-2", "nested"]);
  });

  it("normalizes depth jumps the way the outline does", () => {
    const state = apply(board(), { project: "Greeter", tasks: [
      { name: "A", depth: 2 }, { name: "B", depth: 2 }, { name: "C", depth: 2 },
    ] });
    expect(outlineOf(state, state.tasks[0]!.goalId).map((item) => item.depth)).toEqual([0, 1, 2]);
  });

  it("keeps explicit dependencies and gates when the outline changes, including an empty list", () => {
    const result = planned(board(), { project: "Greeter", tasks: [
      { name: "A" }, { name: "B", depth: 1 },
      { name: "C", dependsOn: [{ task: "A", gate: "completed" }] },
      { name: "D", dependsOn: [] }, { name: "E" },
    ] });
    const state = result.actions.reduce(reducer, board());
    expect(result.actions[2]).toMatchObject({ type: "createTask", task: { wired: true } });
    const manual = state.dependencies.filter((dep) => dep.target === "api-3");
    expect(manual).toEqual([{ id: "api-1->api-3", source: "api-1", target: "api-3", gate: "completed" }]);
    expect(state.dependencies.filter((dep) => dep.target === "api-4")).toEqual([]);
    const reordered = reducer(state, { type: "setOutline", goalId: result.goalId,
      items: ["api-4", "api-1", "api-3", "api-2", "api-5"].map((id) => ({ id, depth: 0 })),
    });
    expect(reordered.dependencies.filter((dep) => dep.target === "api-3")).toEqual(manual);
    expect(reordered.dependencies.filter((dep) => dep.target === "api-4")).toEqual([]);
  });

  it.each([-1, 3, 0.5, "1", null, true, {}, []])("rejects invalid depth %j", (depth) => {
    expect(planTasks(board(), { project: "Greeter", name: "A", depth }, ids)).toEqual({ error: "depth must be an integer from 0 to 2." });
    expect(planTasks(board(), { project: "Greeter", tasks: [{ name: "A", depth }] }, ids)).toEqual({ error: "tasks[0].depth must be an integer from 0 to 2." });
  });

  it.each([[], ["A"], null])("asks callers to pick one when depth and dependsOn %j are both supplied", (dependsOn) => {
    expect(planTasks(board(), { project: "Greeter", name: "B", depth: 0, dependsOn }, ids)).toEqual({ error: "The task: pick one of depth or dependsOn." });
    expect(planTasks(board(), { project: "Greeter", tasks: [{ name: "A" }, { name: "B", depth: 1, dependsOn }] }, ids))
      .toEqual({ error: "tasks[1]: pick one of depth or dependsOn." });
  });

  it("explains what is wrong with a request", () => {
    const state = apply(board(), { project: "Greeter", tasks: [{ name: "Same" }, { name: "Same" }] });
    const error = (body: unknown) => (planTasks(state, body, ids) as { error: string }).error;
    expect(error({ name: "X" })).toBe("Say which task, as goal, or which project.");
    expect(error({ project: "Nope", name: "X" })).toMatch(/^There is no project Nope\./);
    expect(error({ project: "Greeter", tasks: [] })).toBe("There are no tasks to add.");
    expect(error({ project: "Greeter", tasks: [{ objective: "no name" }] })).toBe("tasks[0] needs a name.");
    expect(error({ project: "Greeter", name: 5 })).toBe("name must be a string.");
    expect(error({ project: "Greeter", tasks: [{ name: "X", checkCommand: ["npm", "test"] }] })).toBe("tasks[0].checkCommand must be a string.");
    expect(error({ project: "Greeter", name: "X", agent: "gpt" })).toBe("agent must be one of: codex, claude.");
    expect(error({ project: "Greeter", name: "X", runner: "robot" })).toBe('runner must be "agent" or "human".');
    expect(error({ project: "Greeter", name: "X", dependsOn: ["Missing"] })).toBe("The task depends on Missing, which is not a step in this task.");
    expect(error({ project: "Greeter", name: "X", dependsOn: ["Same"] })).toBe("The task depends on Same, but more than one task has that name. Use its id.");
    expect(error({ project: "Greeter", name: "X", dependsOn: [{ task: "api-1", gate: "soon" }] })).toBe(
      'A dependsOn gate must be "completed" or "verified".',
    );
    expect(error({ project: "Workspace", name: "X", dependsOn: ["api-1"] })).toMatch(/not a step in this task/);
    expect(error({ project: "Greeter", name: "X", autoRun: "yes" })).toBe("autoRun must be true or false.");
    expect(error({ project: "Greeter", name: "X", pushBeforeRun: "yes" })).toBe("pushBeforeRun must be true or false.");
    expect(error({ project: "Greeter", name: "X", runner: "human", pushBeforeRun: true })).toMatch(/done by a person/);
    expect(error({ project: "Greeter", name: "X", runner: "human", review: true })).toMatch(/done by a person/);
    expect(error({ project: "Greeter", name: "X", runner: "human", autoRun: true })).toMatch(/done by a person/);
  });

  it("sets up tasks that start on their own, judge independently, or wait for your review", () => {
    const state = apply(board(), {
      project: "Greeter",
      tasks: [
        { name: "Build", checkCommand: "npm run build", autoRun: true },
        { name: "Test", checkCommand: "npm test", independent: true, review: true, autoRun: true, pushBeforeRun: true, dependsOn: ["Build"] },
      ],
    });
    const [build, test] = state.tasks;
    expect(build).toMatchObject({ autoRun: true });
    expect(build!.independent).toBeUndefined();
    expect(build!.verification.map((check) => check.kind)).toEqual(["command"]);
    expect(test).toMatchObject({ autoRun: true, independent: true, pushBeforeRun: true });
    expect(test!.verification.map((check) => check.kind)).toEqual(["command", "review"]);
  });

  it("gives a step the model and thinking asked for, and only to an agent", () => {
    const state = apply(board(), { project: "Greeter", tasks: [{ name: "Audit", model: "gpt-6-astra", thinking: "max" }, { name: "Plain" }] });
    expect(state.tasks[0]).toMatchObject({ model: "gpt-6-astra", effort: "max" });
    expect(state.tasks[1]!.model).toBeUndefined();
    const error = (body: unknown) => (planTasks(board(), body, ids) as { error: string }).error;
    expect(error({ project: "Greeter", name: "X", model: "--yolo" })).toMatch(/^model is not a model name/);
    expect(error({ project: "Greeter", name: "X", thinking: "lots" })).toBe("thinking must be one of: low, medium, high, xhigh, max, ultra.");
    expect(error({ project: "Greeter", name: "X", runner: "human", model: "opus" })).toMatch(/done by a person/);
  });
});

describe("planProject", () => {
  it("creates a project with a free folder, or explains why not", () => {
    const result = planProject(board(), { name: "Hello counter", summary: "Counter app" }, "proj-api-1");
    expect(result).toMatchObject({ project: { id: "proj-api-1", name: "Hello counter", summary: "Counter app", directory: "hello-counter" } });
    const error = (body: unknown) => (planProject(board(), body, "proj-api-1") as { error: string }).error;
    expect(error({})).toBe("The project needs a name.");
    expect(error({ name: "greeter" })).toBe("There is already a project named Greeter (proj-2).");
    expect(error({ name: "Elsewhere", directory: "../outside" })).toMatch(/Use repo/);
    expect(error({ name: "Elsewhere", repo: "relative/path" })).toMatch(/must be absolute/);
    expect(planProject(board(), { name: "Elsewhere", repo: "/tmp/my-repo" }, "proj-api-1")).toMatchObject({ project: { repo: "/tmp/my-repo" } });
  });
});

describe("boardSummary", () => {
  it("lists each project's tasks with what an outside agent needs to depend on them", () => {
    const state = apply(board(), { project: "Greeter", tasks: [{ name: "A" }, { name: "B", dependsOn: ["A"] }] });
    expect(boardSummary(state).projects[1]!.tasks).toMatchObject([
      { id: "api-1", name: "A", status: "queued", verified: false, dependsOn: [] },
      { id: "api-2", name: "B", dependsOn: [{ task: "api-1", gate: "verified" }] },
    ]);
  });
});

it("accepts the optional work check through POST task planning and rejects invalid or human options", () => {
  const state = apply(board(), { project: "Greeter", name: "Build", acceptance: ["Works"], workCheck: true });
  expect(state.tasks[0].verification).toMatchObject([{ kind: "work", state: "pending" }]);
  expect(planTasks(board(), { project: "Greeter", name: "Build", workCheck: "yes" }, ids)).toEqual({ error: "workCheck must be true or false." });
  expect(planTasks(board(), { project: "Greeter", name: "Build", runner: "human", workCheck: true }, ids)).toHaveProperty("error");
});
