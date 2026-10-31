import { describe, expect, it } from "vitest";
import { interruptWork, loadState } from "./migrate";
import { workspace } from "./workspace";

const schemaOneTask = {
  id: "task-1",
  projectId: "proj-slug",
  name: "Slugify",
  objective: "Write slug.mjs",
  repo: "slug-helper",
  branch: "feat/slugify",
  progress: 100,
  status: "awaiting_approval",
  runner: "agent",
  agentId: "agent-codex",
  worktree: "slugify",
  acceptance: [
    { id: "a1", text: "The objective is met", done: false },
    { id: "a2", text: "Handles accents", done: true },
  ],
  verification: [
    { id: "c1", kind: "command", state: "passed", timestamp: 5, evidence: "exited 0", command: "node check.mjs", exitCode: 0, output: "ok" },
    { id: "c2", kind: "unit", state: "passed", timestamp: 5, evidence: "simulated" },
    { id: "c3", kind: "review", state: "not_applicable", timestamp: null, evidence: "" },
  ],
  filesChanged: [{ path: "slugify/slug.mjs", additions: 12, deletions: 0 }],
  artifacts: [{ id: "x", kind: "file", title: "slugify/slug.mjs", summary: "export function slug() {}" }],
  selfReportedComplete: true,
  position: { x: 10, y: 20 },
};

const schemaOne = {
  schema: 1,
  projects: [{ id: "proj-slug", name: "Slug helper", summary: "", repos: [{ name: "slug-helper", branch: "local" }], directory: "slug-helper" }],
  agents: [{ id: "agent-codex", tokens: 1200 }],
  tasks: [schemaOneTask],
  dependencies: [],
  events: [],
  notifications: [],
  runs: [],
  simPaused: true,
  now: 1,
  seq: 4,
};

describe("loadState", () => {
  it("migrates a schema 1 board and drops what no longer exists", () => {
    const state = loadState(schemaOne)!;
    expect(state.schema).toBe(2);
    expect(state).not.toHaveProperty("agents");
    expect(state.projects).toEqual([{ id: "proj-slug", name: "Slug helper", summary: "", directory: "slug-helper" }]);

    const task = state.tasks[0]!;
    expect(task.status).toBe("queued");
    expect(task.acceptance).toEqual(["Handles accents"]);
    expect(task.verification.map((check) => check.kind)).toEqual(["command"]);
    expect(task.verification[0]).toMatchObject({ command: "node check.mjs", exitCode: 0, output: "ok" });
    expect(task.filesChanged).toEqual(["slugify/slug.mjs"]);
    expect(task.previews).toEqual([{ path: "slugify/slug.mjs", text: "export function slug() {}" }]);
    expect(task.position).toEqual({ x: 10, y: 20 });
    for (const gone of ["repo", "branch", "progress", "artifacts", "selfReportedComplete"]) {
      expect(task).not.toHaveProperty(gone);
    }
  });

  it("keeps a task's branch and gives every project a folder", () => {
    const git = {
      branch: "shepherd/slugify",
      folder: "/tmp/worktrees/slugify",
      target: "main",
      head: "1111111",
      merged: { into: "main", sha: "2222222", at: 3 },
    };
    const state = loadState({
      ...schemaOne,
      projects: [
        { id: "proj-local", name: "Workspace", summary: "" },
        { id: "proj-slug", name: "Slug helper", summary: "" },
      ],
      tasks: [{ ...schemaOneTask, git }],
    })!;
    expect(state.projects.map((project) => project.directory)).toEqual(["workspace", "slug-helper"]);
    expect(state.tasks[0]!.git).toEqual(git);
    expect(loadState({ ...schemaOne, tasks: [{ ...schemaOneTask, git: { branch: "shepherd/x" } }] })!.tasks[0]).not.toHaveProperty("git");
  });

  it("keeps a task's run-automatically and independent settings", () => {
    const [on, off] = loadState({
      ...schemaOne,
      tasks: [
        { ...schemaOneTask, autoRun: true, independent: true },
        { ...schemaOneTask, id: "other", autoRun: "yes" },
      ],
    })!.tasks;
    expect(on).toMatchObject({ autoRun: true, independent: true });
    expect(off).not.toHaveProperty("autoRun");
    expect(off).not.toHaveProperty("independent");
  });

  it("keeps a schema 2 board as it is", () => {
    const state = workspace(1);
    expect(loadState(state)).toEqual(state);
  });

  it("refuses demo boards, unknown schemas, and boards with no project", () => {
    expect(loadState({ ...schemaOne, projects: [{ id: "proj-checkout", name: "Checkout", summary: "" }] })).toBeNull();
    expect(loadState({ ...schemaOne, schema: 3 })).toBeNull();
    expect(loadState({ ...schemaOne, projects: [] })).toBeNull();
    expect(loadState("nonsense")).toBeNull();
  });
});

describe("interruptWork", () => {
  it("clears a check that was running when the server stopped", () => {
    const state = loadState({
      ...schemaOne,
      tasks: [{ ...schemaOneTask, verification: [{ ...schemaOneTask.verification[0], state: "pending", running: true }] }],
    })!;
    expect(state.tasks[0]!.verification[0]!.running).toBe(true);
    const check = interruptWork(state).tasks[0]!.verification[0]!;
    expect(check.running).toBe(false);
    expect(check.evidence).toBe("Interrupted when Shepherd restarted. Run it again.");
  });

  it("fails a run that was going when the server stopped, so it can be retried", () => {
    const state = loadState({ ...schemaOne, tasks: [{ ...schemaOneTask, status: "running" }] })!;
    const task = interruptWork(state).tasks[0]!;
    expect(task.status).toBe("failed");
    expect(task.blocker).toBe("Shepherd restarted while this was running. Retry it.");
  });
});
