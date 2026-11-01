import { describe, expect, it } from "vitest";
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
    expect(twice.actions[0]).toMatchObject({ type: "createTask", task: { worktree: "greet-module-2" } });
  });

  it("explains what is wrong with a request", () => {
    const state = apply(board(), { project: "Greeter", tasks: [{ name: "Same" }, { name: "Same" }] });
    const error = (body: unknown) => (planTasks(state, body, ids) as { error: string }).error;
    expect(error({ name: "X" })).toBe("Say which project, by id or name. Projects: Workspace (proj-local), Greeter (proj-2).");
    expect(error({ project: "Nope", name: "X" })).toMatch(/^There is no project Nope\./);
    expect(error({ project: "Greeter", tasks: [] })).toBe("There are no tasks to add.");
    expect(error({ project: "Greeter", tasks: [{ objective: "no name" }] })).toBe("tasks[0] needs a name.");
    expect(error({ project: "Greeter", name: 5 })).toBe("name must be a string.");
    expect(error({ project: "Greeter", tasks: [{ name: "X", checkCommand: ["npm", "test"] }] })).toBe("tasks[0].checkCommand must be a string.");
    expect(error({ project: "Greeter", name: "X", agent: "gpt" })).toBe("agent must be one of: codex, claude.");
    expect(error({ project: "Greeter", name: "X", runner: "robot" })).toBe('runner must be "agent" or "human".');
    expect(error({ project: "Greeter", name: "X", dependsOn: ["Missing"] })).toBe("The task depends on Missing, which is not a task in this project.");
    expect(error({ project: "Greeter", name: "X", dependsOn: ["Same"] })).toBe("The task depends on Same, but more than one task has that name. Use its id.");
    expect(error({ project: "Greeter", name: "X", dependsOn: [{ task: "api-1", gate: "soon" }] })).toBe(
      'A dependsOn gate must be "completed" or "verified".',
    );
    expect(error({ project: "Workspace", name: "X", dependsOn: ["api-1"] })).toMatch(/not a task in this project/);
    expect(error({ project: "Greeter", name: "X", autoRun: "yes" })).toBe("autoRun must be true or false.");
    expect(error({ project: "Greeter", name: "X", runner: "human", review: true })).toMatch(/done by a person/);
    expect(error({ project: "Greeter", name: "X", runner: "human", autoRun: true })).toMatch(/done by a person/);
  });

  it("sets up tasks that start on their own, judge independently, or wait for your review", () => {
    const state = apply(board(), {
      project: "Greeter",
      tasks: [
        { name: "Build", checkCommand: "npm run build", autoRun: true },
        { name: "Test", checkCommand: "npm test", independent: true, review: true, autoRun: true, dependsOn: ["Build"] },
      ],
    });
    const [build, test] = state.tasks;
    expect(build).toMatchObject({ autoRun: true });
    expect(build!.independent).toBeUndefined();
    expect(build!.verification.map((check) => check.kind)).toEqual(["command"]);
    expect(test).toMatchObject({ autoRun: true, independent: true });
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
    expect(error({ name: "Elsewhere", directory: "../outside" })).toMatch(/inside the workspace/);
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
