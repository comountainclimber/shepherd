import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newStep } from "../src/model/factory";
import { reducer } from "../src/model/reducer";
import { workspace } from "../src/model/workspace";
import { createEngine } from "./engine";
import { availableRepo, availableWorkspace, inspectWorkspace } from "./projectRepos";
import { createRunner } from "./runner";
import { workspaceGit } from "./workspaceGit";

vi.setConfig({ testTimeout: 30_000 });
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function command(cwd: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=Person", "-c", "user.email=person@example.test", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
}

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "shepherd-workspace-")));
  roots.push(root);
  const directory = path.join(root, "projects");
  for (const [name, branch] of [["api", "main"], ["web", "develop"]]) {
    const repo = path.join(directory, name);
    mkdirSync(repo, { recursive: true });
    command(repo, "init", "-q", "-b", branch);
    writeFileSync(path.join(repo, "source.txt"), `${name}\n`);
    command(repo, "add", ".");
    command(repo, "commit", "-qm", "Initial");
  }
  mkdirSync(path.join(directory, "not-a-repo"));
  return { root, directory, api: path.join(directory, "api"), web: path.join(directory, "web") };
}

describe("multi-repository workspaces", () => {
  it("discovers immediate repositories, resolves aliases, and refuses overlapping imports or unusable repositories", async () => {
    const { directory, root, api } = fixture();
    const collection = await inspectWorkspace(directory);
    expect(collection.repositories.map((repo) => repo.name)).toEqual(["api", "web"]);
    const board = reducer(workspace(), { type: "createProject", project: { id: "multi", name: "Multi", summary: "", workspace: collection } });
    expect(() => availableWorkspace(collection, board, root)).toThrow(/already belongs/);
    await expect(availableRepo(api, board, root)).rejects.toThrow(/already belongs/);
    symlinkSync(api, path.join(directory, "alias"));
    await expect(inspectWorkspace(directory)).rejects.toThrow(/already included/);
    rmSync(path.join(directory, "alias"));
    mkdirSync(path.join(directory, "empty"));
    command(path.join(directory, "empty"), "init", "-q");
    await expect(inspectWorkspace(directory)).rejects.toThrow(/no commits/);
    await expect(inspectWorkspace(api)).rejects.toThrow(/parent directory/);
    await expect(inspectWorkspace("relative")).rejects.toThrow(/absolute/);
    await expect(inspectWorkspace(path.join(directory, "not-a-repo"))).rejects.toThrow(/No Git repositories/);
  });

  it("keeps parallel step worktrees separate and restores their branches after restart", async () => {
    const { root, directory, api } = fixture();
    const collection = await inspectWorkspace(directory);
    const worktrees = path.join(root, "worktrees");
    const git = workspaceGit(collection, worktrees);
    const goal = await git.openGoalWorktree(directory, worktrees, "goal", "cross-repo");
    const first = await git.openWorktree(directory, worktrees, "one", "one", undefined, { start: goal.branch });
    const second = await git.openWorktree(directory, worktrees, "two", "two", undefined, { start: goal.branch });
    writeFileSync(path.join(first.folder, "api", "source.txt"), "first\n");
    expect(readFileSync(path.join(second.folder, "api", "source.txt"), "utf8")).toBe("api\n");
    expect(readFileSync(path.join(api, "source.txt"), "utf8")).toBe("api\n");
    await git.commitAll(first.folder, ["First"], { name: "Agent", email: "agent@example.test" });
    expect((await git.changes(first.folder, first.branch)).files).toEqual(["api/source.txt"]);
    const restarted = workspaceGit(collection, worktrees);
    expect(await restarted.openGoalWorktree(directory, worktrees, "goal", "cross-repo", { branch: goal.branch, base: goal.target })).toMatchObject({ folder: goal.folder, branch: goal.branch });
    expect(await restarted.openWorktree(directory, worktrees, "one", "one", first.branch, { start: goal.branch })).toMatchObject({ folder: first.folder, branch: first.branch });
  });

  it("rejects workspace roots overlapping folder projects, including aliases and folders not created yet", async () => {
    const { root, directory } = fixture();
    const collection = await inspectWorkspace(directory);
    symlinkSync(directory, path.join(root, "alias"));
    for (const folder of ["projects", ".", "projects/not-a-repo", "projects/not-created/child", "alias", "alias/not-created"]) {
      const board = {
        ...workspace(), workspace: root,
        projects: [{ id: "folder", name: "Existing folder", summary: "", directory: folder }],
      };
      expect(() => availableWorkspace(collection, board, "/unused")).toThrow(/already belongs to Existing folder/);
    }
    const board = {
      ...workspace(),
      projects: [{ id: "folder", name: "Separate folder", summary: "", directory: "projects-sibling" }],
    };
    expect(availableWorkspace(collection, board, root)).toBe(collection);
    expect(() => availableWorkspace(collection, {
      ...board, projects: [{ id: "folder", name: "Default folder", summary: "", directory: "projects" }],
    }, root)).toThrow(/already belongs/);
  });

  it.each(["deleted", "ownership changed"])("refuses a persisted step whose branch was %s without recreating it", async (damage) => {
    const { root, directory, api } = fixture();
    const collection = await inspectWorkspace(directory);
    const worktrees = path.join(root, "worktrees");
    const git = workspaceGit(collection, worktrees);
    const goal = await git.openGoalWorktree(directory, worktrees, "goal", "integrity");
    const step = await git.openWorktree(directory, worktrees, "step", "integrity-step", undefined, { start: goal.branch });
    const folder = path.join(step.folder, "api");
    const branch = command(folder, "branch", "--show-current");
    writeFileSync(path.join(folder, "proof.txt"), "Keep this work\n");
    await git.commitAll(step.folder, ["Step work"], { name: "Agent", email: "agent@example.test" });
    const head = command(folder, "rev-parse", "HEAD");
    if (damage === "deleted") {
      command(api, "worktree", "remove", folder);
      command(api, "branch", "-D", branch);
    } else {
      command(api, "config", `branch.${branch}.shepherdtask`, "another-step");
    }
    const reopened = workspaceGit(collection, worktrees);
    await expect(reopened.openWorktree(directory, worktrees, "step", "integrity-step", step.branch, { start: goal.branch }))
      .rejects.toThrow(/missing or no longer belongs/);
    if (damage === "deleted") {
      expect(command(api, "branch", "--list", branch)).toBe("");
    } else {
      expect(command(folder, "rev-parse", "HEAD")).toBe(head);
      expect(readFileSync(path.join(folder, "proof.txt"), "utf8")).toBe("Keep this work\n");
    }
  });

  it("refuses two checkouts sharing one repository instead of reusing their branches", async () => {
    const { directory, api } = fixture();
    command(api, "worktree", "add", "-q", "-b", "other", path.join(directory, "api-other"));
    await expect(inspectWorkspace(directory)).rejects.toThrow(/same Git repository/);
  });

  it("runs cross-repository steps and checks, collects upstream work, persists, and explicitly merges into different base branches", async () => {
    const { root, directory, api, web } = fixture();
    const collection = await inspectWorkspace(directory);
    let board = reducer(workspace(), { type: "createProject", project: { id: "multi", name: "Multi", summary: "", workspace: collection } });
    const goalId = "goal-multi";
    board = reducer(board, {
      type: "addSteps", goalId, after: null,
      steps: ["Build", "Follow"].map((name) => ({
        depth: 0,
        task: {
          ...newStep("multi", name, name), id: name.toLowerCase(), goalId,
          checkCommand: `test -f api/${name.toLowerCase()}.txt && test -f web/${name.toLowerCase()}.txt`,
        },
      })),
    });
    const engine = createEngine(path.join(root, "board.json"), undefined, board);
    const agent = path.join(root, "agent.mjs");
    writeFileSync(agent, `
      import { writeFileSync, existsSync } from "node:fs";
      const prompt = process.argv[2];
      const name = /Objective: (Build|Follow)/.exec(prompt)[1].toLowerCase();
      if (name === "follow" && (!existsSync("api/build.txt") || !existsSync("web/build.txt"))) process.exit(4);
      for (const repo of ["api", "web"]) writeFileSync(repo + "/" + name + ".txt", name + "\\n");
      console.log(JSON.stringify({ type: "turn.completed" }));
    `);
    const options = {
      engine, sandbox: path.join(root, "sandbox"), worktrees: path.join(root, "worktrees"),
      evidence: path.join(root, "evidence"), gate: path.join(root, "gate"),
      loggedIn: async () => true,
      command: (_provider: unknown, prompt: string) => ({ cmd: process.execPath, args: [agent, prompt] }),
    };
    const runner = createRunner(options);
    try {
      expect(await runner.handle({ command: "runPlan", goalId })).toEqual({ ok: true });
      await runner.idle();
      const steps = engine.get().tasks;
      expect(steps.map((step) => [step.status, step.blocker])).toEqual([["completed", null], ["completed", null]]);
      expect(steps.every((step) => step.verification.every((check) => check.state === "passed"))).toBe(true);
      expect(steps[0].filesChanged).toEqual(["api/build.txt", "web/build.txt"]);
      expect(steps[1].filesChanged).toEqual(["api/follow.txt", "web/follow.txt"]);
      expect(command(api, "status", "--porcelain")).toBe("");
      expect(command(web, "status", "--porcelain")).toBe("");
      expect(command(api, "branch", "--show-current")).toBe("main");
      expect(command(web, "branch", "--show-current")).toBe("develop");
      // Preflight every checkout before merging any of them.
      writeFileSync(path.join(web, "source.txt"), "Local edits\n");
      expect(await runner.handle({ command: "mergePlan", goalId })).toHaveProperty("error", expect.stringContaining("uncommitted changes"));
      expect(command(api, "ls-files", "build.txt")).toBe("");
      writeFileSync(path.join(web, "source.txt"), "web\n");
      expect(await runner.handle({ command: "mergePlan", goalId })).toEqual({ ok: true });
      for (const repo of [api, web]) {
        expect(readFileSync(path.join(repo, "build.txt"), "utf8")).toBe("build\n");
        expect(readFileSync(path.join(repo, "follow.txt"), "utf8")).toBe("follow\n");
      }
      engine.flush();
    } finally { runner.close(); engine.close(); }
    const restarted = createEngine(path.join(root, "board.json"));
    try {
      expect(restarted.get().projects.find((project) => project.id === "multi")?.workspace).toEqual(collection);
      expect(restarted.get().goals.find((goal) => goal.id === goalId)?.merged).toBeTruthy();
    } finally { restarted.close(); }
  });

  it("preflights conflicts in every repository before merging any checkout", async () => {
    const { root, directory, api, web } = fixture();
    const collection = await inspectWorkspace(directory);
    const git = workspaceGit(collection, path.join(root, "worktrees"));
    const goal = await git.openGoalWorktree(directory, root, "goal", "conflict");
    for (const name of ["api", "web"]) writeFileSync(path.join(goal.folder, name, "source.txt"), "Task changes\n");
    await git.commitAll(goal.folder, ["Task work"], { name: "Agent", email: "agent@example.test" });
    writeFileSync(path.join(web, "source.txt"), "Other changes\n");
    command(web, "commit", "-qam", "Other work");
    await expect(git.mergeBranch(directory, goal.branch, "Merge", goal.target)).rejects.toThrow(/Nothing was changed/);
    expect(readFileSync(path.join(api, "source.txt"), "utf8")).toBe("api\n");
    expect(readFileSync(path.join(web, "source.txt"), "utf8")).toBe("Other changes\n");
  });
});
