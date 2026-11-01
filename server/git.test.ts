import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changes, commitAll, ensureRepo, inspectRepo, mergeBranch, markAccepted, openGoalWorktree, openWorktree, prepareRun } from "./git";

const AGENT = { name: "Codex", email: "codex@shepherd.local" };
let temps: string[] = [];

afterEach(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  temps = [];
});

function temp() {
  const dir = mkdtempSync(path.join(tmpdir(), "shepherd-git-"));
  temps.push(dir);
  return dir;
}

function gitOut(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@t" },
  }).trim();
}

async function project() {
  const root = temp();
  const repo = await ensureRepo(path.join(root, "project"));
  return { repo, worktrees: path.join(root, "worktrees") };
}

function write(folder: string, file: string, text: string) {
  writeFileSync(path.join(folder, file), text);
}

describe("ensureRepo", () => {
  it("makes a plain folder a repository and commits what is already there", async () => {
    const dir = path.join(temp(), "notes");
    mkdirSync(dir);
    write(dir, "todo.md", "- ship\n");
    const repo = await ensureRepo(dir);
    expect(gitOut(repo, "log", "--format=%s")).toBe("Shepherd: initial commit");
    expect(gitOut(repo, "ls-files")).toBe("todo.md");
    expect(readFileSync(path.join(repo, ".git", "info", "exclude"), "utf8")).toContain("node_modules/");
    await ensureRepo(dir);
    expect(gitOut(repo, "rev-list", "--count", "HEAD")).toBe("1");
  });

  it("refuses a folder inside another repository unless that repository ignores it", async () => {
    const outer = temp();
    gitOut(outer, "init", "-q");
    write(outer, ".gitignore", "sandbox/\n");
    await expect(ensureRepo(path.join(outer, "src"))).rejects.toThrow(/inside the git repository/);
    const nested = await ensureRepo(path.join(outer, "sandbox", "app"));
    expect(gitOut(nested, "rev-parse", "--show-toplevel")).toBe(nested);
  });
});

describe("inspectRepo", () => {
  it("refuses missing, plain, nested and empty folders without writing anything", async () => {
    const root = temp();
    const missing = path.join(root, "missing");
    await expect(inspectRepo(missing)).rejects.toThrow(missing);
    expect(existsSync(missing)).toBe(false);
    await expect(inspectRepo(root)).rejects.toThrow(`${root} is not a git repository`);
    expect(readdirSync(root)).toEqual([]);
    gitOut(root, "init", "-q");
    write(root, "mine.txt", "mine");
    const before = gitOut(root, "status", "--porcelain");
    await expect(inspectRepo(root)).rejects.toThrow(`${root} has no commits`);
    expect(gitOut(root, "status", "--porcelain")).toBe(before);
    expect(gitOut(root, "ls-files")).toBe("");
    gitOut(root, "add", "mine.txt");
    gitOut(root, "commit", "-qm", "Person's first commit");
    const nested = path.join(root, "nested");
    mkdirSync(nested);
    await expect(inspectRepo(nested)).rejects.toThrow(`${nested} is inside a git repository`);
    expect(readdirSync(nested)).toEqual([]);
    expect(gitOut(root, "rev-list", "--count", "HEAD")).toBe("1");
  });

  it("returns the canonical root and checked-out branch, including detached HEAD", async () => {
    const { repo } = await project();
    const alias = path.join(temp(), "alias");
    symlinkSync(repo, alias);
    expect(await inspectRepo(alias)).toEqual({ repo, branch: gitOut(repo, "branch", "--show-current") });
    gitOut(repo, "checkout", "-q", "--detach");
    expect((await inspectRepo(repo)).branch).toMatch(/^detached at /);
  });

  it("does not commit on a person's branch, even if a step folder was switched to it", async () => {
    const { repo, worktrees } = await project();
    const tree = await openWorktree(repo, worktrees, "task-1", "safe");
    gitOut(tree.folder, "checkout", "-qb", "my-work");
    write(tree.folder, "mine.txt", "mine");
    await expect(commitAll(tree.folder, ["Should not happen"], AGENT)).rejects.toThrow(/was not created/);
    await expect(openWorktree(repo, worktrees, "task-1", "safe", tree.branch)).rejects.toThrow(/no longer on/);
    expect(gitOut(tree.folder, "rev-list", "--count", "HEAD")).toBe("1");
    expect(gitOut(tree.folder, "ls-files", "mine.txt")).toBe("");
  });
});

describe("worktrees", () => {
  it("keeps a task on its own branch and never hands that branch to another task", async () => {
    const { repo, worktrees } = await project();
    const first = await openWorktree(repo, worktrees, "task-1", "parser");
    expect(first.branch).toBe("shepherd/parser");
    expect(existsSync(path.join(first.folder, ".git"))).toBe(true);
    expect(first.target).toBe(gitOut(repo, "symbolic-ref", "--short", "HEAD"));

    const again = await openWorktree(repo, worktrees, "task-1", "parser", first.branch);
    expect(again.folder).toBe(first.folder);

    const other = await openWorktree(repo, worktrees, "task-9", "parser");
    expect(other.branch).toBe("shepherd/parser-2");
    expect(other.folder).not.toBe(first.folder);
  });

  it("recreates a worktree whose folder was deleted", async () => {
    const { repo, worktrees } = await project();
    const tree = await openWorktree(repo, worktrees, "task-1", "parser");
    write(tree.folder, "a.txt", "a\n");
    await commitAll(tree.folder, ["Write a"], AGENT);
    rmSync(tree.folder, { recursive: true, force: true });
    const back = await openWorktree(repo, worktrees, "task-1", "parser", tree.branch);
    expect(readFileSync(path.join(back.folder, "a.txt"), "utf8")).toBe("a\n");
  });

  it("commits a stopped run's leftovers before the next run", async () => {
    const { repo, worktrees } = await project();
    const tree = await openWorktree(repo, worktrees, "task-1", "parser");
    write(tree.folder, "half.txt", "partial\n");
    await prepareRun(tree, [], AGENT);
    expect(gitOut(tree.folder, "log", "-1", "--format=%s %an")).toBe("Shepherd: changes left by a stopped run Codex");
    expect(gitOut(tree.folder, "status", "--porcelain")).toBe("");
  });
});

describe("changes", () => {
  it("shows only the task's own work, even after upstream work is merged in", async () => {
    const { repo, worktrees } = await project();
    const upstream = await openWorktree(repo, worktrees, "task-a", "contract");
    write(upstream.folder, "contract.md", "v1\n");
    await commitAll(upstream.folder, ["Write the contract"], AGENT);

    const task = await openWorktree(repo, worktrees, "task-b", "parser");
    expect(await prepareRun(task, [upstream.branch], AGENT)).toEqual([upstream.branch]);
    expect(readFileSync(path.join(task.folder, "contract.md"), "utf8")).toBe("v1\n");
    write(task.folder, "parser.mjs", "export const parse = () => 1;\n");
    await commitAll(task.folder, ["Write the parser", "Parses one thing."], AGENT);

    let diff = await changes(task.folder, task.branch);
    expect(diff.files).toEqual(["parser.mjs"]);
    expect(diff.diffs[0]!.text).toContain("+export const parse = () => 1;");
    expect(gitOut(task.folder, "log", "-1", "--format=%an|%s|%b")).toBe("Codex|Write the parser|Parses one thing.");

    write(upstream.folder, "contract.md", "v2\n");
    await commitAll(upstream.folder, ["Revise the contract"], AGENT);
    expect(await prepareRun(task, [upstream.branch], AGENT)).toEqual([upstream.branch]);
    expect(readFileSync(path.join(task.folder, "contract.md"), "utf8")).toBe("v2\n");
    diff = await changes(task.folder, task.branch);
    expect(diff.files).toEqual(["parser.mjs"]);
    expect(await prepareRun(task, [upstream.branch], AGENT)).toEqual([]);
  });

  it("stops with the files both sides changed when upstream work collides", async () => {
    const { repo, worktrees } = await project();
    const upstream = await openWorktree(repo, worktrees, "task-a", "left");
    const task = await openWorktree(repo, worktrees, "task-b", "right");
    write(upstream.folder, "shared.txt", "left\n");
    await commitAll(upstream.folder, ["Left"], AGENT);
    write(task.folder, "shared.txt", "right\n");
    await commitAll(task.folder, ["Right"], AGENT);

    await expect(prepareRun(task, [upstream.branch], AGENT)).rejects.toThrow(/both changed shared\.txt/);
    expect(gitOut(task.folder, "status", "--porcelain")).toBe("");
    expect(readFileSync(path.join(task.folder, "shared.txt"), "utf8")).toBe("right\n");
  });
});

describe("mergeBranch", () => {
  it("merges a task into the project branch, but not over uncommitted changes", async () => {
    const root = temp();
    const dir = path.join(root, "project");
    mkdirSync(dir);
    write(dir, "readme.md", "hello\n");
    const repo = await ensureRepo(dir);
    const tree = await openWorktree(repo, path.join(root, "worktrees"), "task-1", "feature");
    write(tree.folder, "feature.txt", "done\n");
    await commitAll(tree.folder, ["Add the feature"], AGENT);

    write(repo, "readme.md", "edited\n");
    await expect(mergeBranch(repo, tree.branch, "Merge feature")).rejects.toThrow(/uncommitted changes/);
    gitOut(repo, "checkout", "--", "readme.md");

    const merged = await mergeBranch(repo, tree.branch, "Merge feature");
    expect(merged.into).toBe(tree.target);
    expect(readFileSync(path.join(repo, "feature.txt"), "utf8")).toBe("done\n");
    expect(gitOut(repo, "log", "-1", "--format=%s")).toBe("Merge feature");
    expect(merged.sha).toBe(gitOut(repo, "rev-parse", "--short", "HEAD"));
  });

  it("leaves the project branch untouched when the merge conflicts", async () => {
    const { repo, worktrees } = await project();
    const tree = await openWorktree(repo, worktrees, "task-1", "feature");
    write(tree.folder, "x.txt", "task\n");
    await commitAll(tree.folder, ["Task"], AGENT);
    write(repo, "x.txt", "main\n");
    gitOut(repo, "add", "x.txt");
    gitOut(repo, "commit", "-q", "-m", "Main");
    const before = gitOut(repo, "rev-parse", "HEAD");

    await expect(mergeBranch(repo, tree.branch, "Merge")).rejects.toThrow(/conflicts in x\.txt/);
    expect(gitOut(repo, "rev-parse", "HEAD")).toBe(before);
    expect(gitOut(repo, "status", "--porcelain")).toBe("");
  });
});

describe("task branches", () => {
  it("picks a free task name, keeps its base, and separates new and legacy step names", async () => {
    const { repo, worktrees } = await project();
    const base = gitOut(repo, "branch", "--show-current");
    const initial = gitOut(repo, "rev-parse", "HEAD");
    const legacy = await openWorktree(repo, worktrees, "old-step", "fix");
    gitOut(repo, "branch", "shepherd/fix-2/nested");
    const task = await openGoalWorktree(repo, worktrees, "goal", "fix");
    expect(task.branch).toBe("shepherd/fix-3");
    expect(task.target).toBe(base);
    const namedLikeNamespace = await openGoalWorktree(repo, worktrees, "another-goal", "shepherd-step");
    const step = await openWorktree(repo, worktrees, "new-step", "fix", undefined, { start: task.branch, prefix: "shepherd-step" });
    expect(step.branch).toBe("shepherd-step/fix");
    expect(step.target).toBe(task.branch);
    expect(step.folder).not.toBe(task.folder);
    expect(path.dirname(step.folder)).toBe(path.dirname(namedLikeNamespace.folder));
    expect((await openWorktree(repo, worktrees, "old-step", "fix", legacy.branch, { start: task.branch, prefix: "shepherd-step" })).branch).toBe(legacy.branch);
    gitOut(repo, "checkout", "-qb", "another-base");
    write(repo, "another.txt", "other branch\n");
    gitOut(repo, "add", ".");
    gitOut(repo, "commit", "-qm", "Other branch");
    const again = await openGoalWorktree(repo, worktrees, "goal", "renamed", { branch: task.branch, base: task.target });
    expect(again).toEqual(task);
    expect(gitOut(task.folder, "rev-parse", "HEAD")).toBe(initial);
    await expect(mergeBranch(repo, task.branch, "Wrong base", base)).rejects.toThrow(`no longer on ${base}`);
  });

  it("collects accepted steps into the task folder and includes person commits in later steps", async () => {
    const { repo, worktrees } = await project();
    const initial = gitOut(repo, "rev-parse", "HEAD");
    const task = await openGoalWorktree(repo, worktrees, "goal", "fix");
    const first = await openWorktree(repo, worktrees, "first", "first", undefined, { start: task.branch, prefix: "shepherd-step" });
    write(first.folder, "agent.txt", "agent\n");
    await commitAll(first.folder, ["Agent work"], AGENT);
    await mergeBranch(task.folder, first.branch, "Collect step", task.branch);
    expect(readFileSync(path.join(task.folder, "agent.txt"), "utf8")).toBe("agent\n");
    write(task.folder, "person.txt", "person\n");
    gitOut(task.folder, "add", ".");
    gitOut(task.folder, "commit", "-qm", "Person's own commit");
    const next = await openWorktree(repo, worktrees, "next", "next", undefined, { start: task.branch, prefix: "shepherd-step" });
    for (const file of ["agent.txt", "person.txt"]) expect(existsSync(path.join(next.folder, file))).toBe(true);
    expect(gitOut(repo, "rev-parse", "HEAD")).toBe(initial);
    expect(gitOut(repo, "status", "--porcelain")).toBe("");
    expect(existsSync(path.join(repo, "agent.txt"))).toBe(false);
    await mergeBranch(repo, task.branch, "Explicit task merge", task.target);
    expect(existsSync(path.join(repo, "person.txt"))).toBe(true);
  });

  it("keeps a rerun's own diff when the task branch brings back its already accepted work", async () => {
    const { repo, worktrees } = await project();
    const task = await openGoalWorktree(repo, worktrees, "goal", "fix");
    const step = await openWorktree(repo, worktrees, "step", "step", undefined, { start: task.branch, prefix: "shepherd-step" });
    write(step.folder, "agent.txt", "first version\n");
    await commitAll(step.folder, ["First version"], AGENT);
    await mergeBranch(task.folder, step.branch, "Collect", task.branch);
    await markAccepted(repo, step.branch);
    write(task.folder, "person.txt", "person's commit\n");
    await commitAll(task.folder, ["Person's commit"], AGENT);
    // A stopped run also left edits that have never reached the task branch.
    write(step.folder, "agent.txt", "second version\n");
    await prepareRun(step, [task.branch], AGENT);
    const diff = await changes(step.folder, step.branch);
    expect(diff.files).toEqual(["agent.txt"]);
    expect(diff.diffs[0].text).toContain("+second version");
    expect(readFileSync(path.join(step.folder, "person.txt"), "utf8")).toBe("person's commit\n");
  });

  it("waits for tracked changes in the task folder without committing or losing them", async () => {
    const { repo, worktrees } = await project();
    const task = await openGoalWorktree(repo, worktrees, "goal", "fix");
    write(task.folder, "person.txt", "committed\n");
    await commitAll(task.folder, ["Person's starting point"], AGENT);
    const step = await openWorktree(repo, worktrees, "step", "step", undefined, { start: task.branch, prefix: "shepherd-step" });
    write(step.folder, "agent.txt", "agent\n");
    await commitAll(step.folder, ["Agent work"], AGENT);
    write(task.folder, "person.txt", "staged\n");
    gitOut(task.folder, "add", "person.txt");
    write(task.folder, "person.txt", "unstaged\n");
    const before = gitOut(task.folder, "rev-parse", "HEAD");
    const dirty = gitOut(task.folder, "status", "--porcelain");
    await expect(mergeBranch(task.folder, step.branch, "Collect", task.branch)).rejects.toThrow(/Commit or stash/);
    expect(gitOut(task.folder, "status", "--porcelain")).toBe(dirty);
    expect(gitOut(task.folder, "rev-parse", "HEAD")).toBe(before);
    expect(readFileSync(path.join(task.folder, "person.txt"), "utf8")).toBe("unstaged\n");
    gitOut(task.folder, "stash", "push", "-qm", "In progress");
    await mergeBranch(task.folder, step.branch, "Collect", task.branch);
    expect(existsSync(path.join(task.folder, "agent.txt"))).toBe(true);
    expect(gitOut(task.folder, "stash", "list")).toContain("In progress");
    expect(existsSync(path.join(repo, "agent.txt"))).toBe(false);
  });
});
