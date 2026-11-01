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
    expect(state.schema).toBe(3);
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

  it("keeps a step's model, thinking and where it was copied from, and drops ones an agent cannot use", () => {
    const [kept, dropped] = loadState({
      ...schemaOne,
      tasks: [
        { ...schemaOneTask, model: "gpt-6-astra", effort: "max", savedFrom: { id: "saved-1", version: 2 } },
        { ...schemaOneTask, id: "other", model: "-x", effort: "lots", savedFrom: { id: "saved-1" } },
      ],
    })!.tasks;
    expect(kept).toMatchObject({ model: "gpt-6-astra", effort: "max", savedFrom: { id: "saved-1", version: 2 } });
    for (const gone of ["model", "effort", "savedFrom"]) expect(dropped).not.toHaveProperty(gone);
  });

  it("keeps known issues and screenshots, drops broken ones, and forgets a checklist being written", () => {
    const look = { file: "m1-390.png", url: "http://localhost:8130/", width: 390, height: 800, at: 2, errors: ["boom"] };
    const issue = { id: "issue-1", text: "The replay link ignores hash changes.", at: 3, stepId: "step-fix" };
    const [kept, broken] = loadState({
      ...schemaOne,
      tasks: [
        { ...schemaOneTask, looks: [look], issues: [issue, { ...issue, id: "issue-2", stepId: undefined }], drafting: true, checklist: "1. Open it." },
        { ...schemaOneTask, id: "other", looks: [{ ...look, file: "../../etc/passwd" }, { url: "x" }], issues: [{ id: "issue-3" }] },
      ],
    })!.tasks;
    expect(kept!.looks).toEqual([look]);
    expect(kept!.issues).toEqual([issue, { id: "issue-2", text: issue.text, at: 3 }]);
    expect(kept).not.toHaveProperty("drafting");
    expect(kept!.checklist).toBe("1. Open it.");
    expect(broken).not.toHaveProperty("looks");
    expect(broken).not.toHaveProperty("issues");
  });

  it("keeps a current board as it is", () => {
    const state = workspace(1);
    expect(loadState(state)).toEqual(state);
  });

  it("keeps an external repository path without adding a workspace folder", () => {
    const state = workspace(1);
    state.projects[0] = { id: state.projects[0].id, name: "Existing", summary: "", repo: "/Users/person/projects/app" };
    expect(loadState(state)?.projects).toEqual(state.projects);
  });

  it("refuses demo boards, unknown schemas, and boards with no project", () => {
    expect(loadState({ ...schemaOne, projects: [{ id: "proj-checkout", name: "Checkout", summary: "" }] })).toBeNull();
    expect(loadState({ ...schemaOne, schema: 4 })).toBeNull();
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

describe("boards before tasks", () => {
  it("gives each project one open task with its outline, running flag and unchanged steps", () => {
    const git = { branch: "shepherd/existing-branch", folder: "/tmp/existing-worktree", target: "feature/original", head: "abc" };
    const raw = {
      ...schemaOne, schema: 2,
      projects: [
        { id: "proj-slug", name: "Slug helper", summary: "", directory: "slug-helper", outline: [{ id: "task-1", depth: 0 }], running: true },
        { id: "empty", name: "Empty", summary: "", directory: "empty", outline: [], running: false },
        { id: "hand", name: "By hand", summary: "", directory: "hand" },
      ],
      tasks: [{ ...schemaOneTask, git }],
    };
    const state = loadState(raw)!;
    expect(state.schema).toBe(3);
    expect(state.goals).toEqual([
      { id: "goal-proj-slug", projectId: "proj-slug", name: "Slug helper", goal: "", status: "open", outline: raw.projects[0]!.outline, running: true },
      { id: "goal-empty", projectId: "empty", name: "Empty", goal: "", status: "open", outline: [], running: false },
      { id: "goal-hand", projectId: "hand", name: "By hand", goal: "", status: "open", running: false },
    ]);
    expect(state.tasks[0]).toMatchObject({ id: "task-1", projectId: "proj-slug", goalId: "goal-proj-slug", worktree: "slugify", git });
    expect(state.projects.every((project) => !("outline" in project) && !("running" in project))).toBe(true);
    expect(state.dependencies).toEqual(raw.dependencies);
    expect(loadState(state)).toEqual(state);
  });

  it("round-trips multiple tasks and their future git fields without collapsing them", () => {
    const board = workspace(1);
    board.goals.push({ id: "second", projectId: board.projects[0]!.id, name: "Second", goal: "Fix it", running: false, status: "archived", branch: "feature/task", folder: "/tmp/task", base: "develop", blocker: "Commit or stash the task folder changes.", merged: { into: "develop", sha: "abc123", at: 42 }, outline: [] });
    const task = { ...schemaOneTask, projectId: board.projects[0].id, goalId: "second", git: { branch: "shepherd/task", folder: "/tmp/task", target: "shepherd/task", diffBase: "old-commit" } };
    expect(loadState({ ...board, tasks: [task] })!.tasks[0].git?.diffBase).toBe("old-commit");
    expect(loadState(board)).toEqual(board);
  });
});
