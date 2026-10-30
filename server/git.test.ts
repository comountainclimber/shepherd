import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changes, commitAll, ensureRepo, mergeBranch, openWorktree, prepareRun } from "./git";

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
