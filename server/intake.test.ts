import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reducer } from "../src/model/reducer";
import type { OrchestrationState } from "../src/model/types";
import { workspace } from "../src/model/workspace";
import { TAB_LIVE_MS, boardSummary, createInbox, planProject, planTasks } from "./intake";

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
  it("adds tasks the way the New task dialog does", () => {
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
    expect(greet!.verification.map((check) => check.kind)).toEqual(["command", "review"]);
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
    expect(error({ project: "Greeter", name: "X", review: false })).toBe("The task skips review, so it needs a checkCommand to verify it.");
    expect(error({ project: "Greeter", name: "X", autoRun: "yes" })).toBe("autoRun must be true or false.");
    expect(error({ project: "Greeter", name: "X", runner: "human", autoRun: true })).toMatch(/done by a person/);
  });

  it("sets up tasks that start on their own, judge independently, or are verified by their check alone", () => {
    const state = apply(board(), {
      project: "Greeter",
      tasks: [
        { name: "Build", checkCommand: "npm run build", review: false, autoRun: true },
        { name: "Test", checkCommand: "npm test", independent: true, autoRun: true, dependsOn: ["Build"] },
      ],
    });
    const [build, test] = state.tasks;
    expect(build).toMatchObject({ autoRun: true });
    expect(build!.independent).toBeUndefined();
    expect(build!.verification.map((check) => check.kind)).toEqual(["command"]);
    expect(test).toMatchObject({ autoRun: true, independent: true });
    expect(test!.verification.map((check) => check.kind)).toEqual(["command", "review"]);
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

describe("inbox", () => {
  function setup() {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "shepherd-inbox-")), "inbox.json");
    let now = 1_000;
    let written: OrchestrationState | null = null;
    const inbox = createInbox(file, (state) => (written = state), () => now);
    return {
      inbox,
      file,
      written: () => written,
      advance: (ms: number) => (now += ms),
      queued: () => (JSON.parse(readFileSync(file, "utf8")) as { batches: unknown[] }).batches,
    };
  }

  it("writes the board itself when no tab is open", () => {
    const { inbox, written, queued } = setup();
    const result = inbox.add(board(), { project: "Greeter", name: "Greet module" });
    expect(result).toMatchObject({ applied: true, project: "proj-2" });
    expect(written()!.tasks.map((task) => task.name)).toEqual(["Greet module"]);
    expect(queued()).toEqual([]);
  });

  it("leaves new tasks to an open tab and forgets them once the tab saves them", () => {
    const { inbox, written, queued } = setup();
    inbox.poll();
    const result = inbox.add(board(), { project: "Greeter", tasks: [{ name: "A" }, { name: "B", dependsOn: ["A"] }] });
    expect(result).toMatchObject({ applied: false });
    expect(written()).toBeNull();

    const preview = inbox.flushOrPreview(board());
    expect(boardSummary(preview.state, preview.pending).projects[1]!.tasks).toMatchObject([
      { name: "A", pending: true, dependsOn: [] },
      { name: "B", pending: true, dependsOn: [{ task: (result as { tasks: { id: string }[] }).tasks[0]!.id, gate: "verified" }] },
    ]);

    const [batch] = inbox.poll();
    const applied = batch!.actions.reduce(reducer, board());
    inbox.saved({ state: { state: board() }, version: 2 });
    expect(queued()).toHaveLength(1);
    inbox.saved({ state: { state: applied }, version: 2 });
    expect(queued()).toEqual([]);
  });

  it("lets later requests depend on tasks still waiting for the tab", () => {
    const { inbox } = setup();
    inbox.poll();
    inbox.add(board(), { project: "Greeter", name: "A" });
    expect(inbox.add(board(), { project: "Greeter", name: "B", dependsOn: ["A"] })).toMatchObject({ applied: false });
  });

  it("writes queued tasks to the board when the tab goes away", () => {
    const { inbox, written, advance, queued } = setup();
    inbox.poll();
    inbox.add(board(), { project: "Greeter", name: "A" });
    advance(TAB_LIVE_MS + 1);
    const { pending } = inbox.flushOrPreview(board());
    expect(pending.size).toBe(0);
    expect(written()!.tasks.map((task) => task.name)).toEqual(["A"]);
    expect(queued()).toEqual([]);
  });

  it("drops queued tasks whose project was deleted", () => {
    const { inbox, queued } = setup();
    inbox.poll();
    inbox.add(board(), { project: "Greeter", name: "A" });
    inbox.saved({ state: { state: workspace(1) }, version: 2 });
    expect(queued()).toEqual([]);
  });

  it("queues a new project and its tasks for the tab, keeping them until a save includes them", () => {
    const { inbox, queued } = setup();
    inbox.poll();
    const created = inbox.addProject(board(), { name: "Hello counter" });
    expect(created).toMatchObject({ applied: false, project: { name: "Hello counter", directory: "hello-counter" } });
    const project = (created as { project: { id: string } }).project.id;
    expect(inbox.add(board(), { project: "Hello counter", name: "Architect" })).toMatchObject({ applied: false, project });

    const preview = inbox.flushOrPreview(board());
    expect(boardSummary(preview.state, preview.pending).projects[2]).toMatchObject({ id: project, pending: true, tasks: [{ name: "Architect" }] });

    // A save from before the tab applied anything keeps both batches, even though the project is not on it yet.
    inbox.saved({ state: { state: board() }, version: 2 });
    expect(queued()).toHaveLength(2);
    const applied = inbox.poll().flatMap((batch) => batch.actions).reduce(reducer, board());
    inbox.saved({ state: { state: applied }, version: 2 });
    expect(queued()).toEqual([]);
  });
});
