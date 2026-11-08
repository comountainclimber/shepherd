import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changes, commitAll, ensureRepo, GitError, inspectRepo, mergeBranch, mergeConflict, MergeConflictError, markAccepted, openGoalWorktree, openWorktree, prepareRun, pushTaskBranch, taskPushRemote } from "./git";

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

async function conflictingSteps() {
  const { repo, worktrees } = await project();
  const task = await openGoalWorktree(repo, worktrees, "goal", "combine");
  const step = await openWorktree(repo, worktrees, "second", "second", undefined, { start: task.branch, prefix: "shepherd-step" });
  const later = await openWorktree(repo, worktrees, "later", "later", undefined, { start: task.branch, prefix: "shepherd-step" });
  write(task.folder, "shared.txt", "left\n");
  write(task.folder, "accepted.txt", "accepted\n");
  await commitAll(task.folder, ["Accepted work"], AGENT);
  write(step.folder, "shared.txt", "right\n");
  write(step.folder, "own.txt", "own\n");
  await commitAll(step.folder, ["Second"], AGENT);
  write(later.folder, "later.txt", "later\n");
  await commitAll(later.folder, ["Later"], AGENT);
  return { repo, task, step, later };
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

    const failure = prepareRun(task, [upstream.branch], AGENT);
    await expect(failure).rejects.toThrow(/both changed shared\.txt/);
    await expect(failure).rejects.toBeInstanceOf(MergeConflictError);
    await expect(failure).rejects.toMatchObject({ files: ["shared.txt"] });
    expect(gitOut(task.folder, "status", "--porcelain")).toBe("");
    expect(readFileSync(path.join(task.folder, "shared.txt"), "utf8")).toBe("right\n");
    expect(await mergeConflict(task.folder)).toBeNull();
  });

  it("keeps the first conflict for the agent and merges the resolved step with only its own diff", async () => {
    const { repo, task, step, later } = await conflictingSteps();
    expect(await prepareRun(step, [task.branch, later.branch], AGENT, { keepConflicts: true })).toEqual([task.branch]);
    expect(await mergeConflict(step.folder)).toEqual({ source: task.branch, files: ["shared.txt"] });
    const marked = readFileSync(path.join(step.folder, "shared.txt"), "utf8");
    expect(marked).toContain("<<<<<<< HEAD\nright\n");
    expect(marked).toContain(`>>>>>>> ${task.branch}`);
    expect(existsSync(path.join(step.folder, "later.txt"))).toBe(false);
    const source = gitOut(task.folder, "rev-parse", "HEAD");
    expect(gitOut(repo, "rev-parse", `refs/shepherd-base/${step.branch}`)).toBe(source);
    const before = gitOut(step.folder, "rev-parse", "HEAD");
    const status = gitOut(step.folder, "status", "--porcelain");
    const failure = commitAll(step.folder, ["Still conflicted"], AGENT);
    await expect(failure).rejects.toBeInstanceOf(MergeConflictError);
    await expect(failure).rejects.toMatchObject({ files: ["shared.txt"] });
    expect(gitOut(step.folder, "rev-parse", "HEAD")).toBe(before);
    expect(gitOut(step.folder, "status", "--porcelain")).toBe(status);

    write(step.folder, "shared.txt", "left\nright\n");
    // Git keeps the path unmerged until the agent stages its resolution.
    expect((await mergeConflict(step.folder))?.files).toEqual(["shared.txt"]);
    await expect(commitAll(step.folder, ["Unstaged resolution"], AGENT)).rejects.toBeInstanceOf(MergeConflictError);
    gitOut(step.folder, "add", "shared.txt");
    expect(await mergeConflict(step.folder)).toEqual({ source: task.branch, files: [] });
    expect(await commitAll(step.folder, ["Combine the steps"], AGENT)).toBe(true);
    expect(gitOut(step.folder, "show", "-s", "--format=%P").split(" ")).toEqual([before, source]);
    expect(await mergeConflict(step.folder)).toBeNull();
    const diff = await changes(step.folder, step.branch);
    expect(diff.files).toEqual(["own.txt", "shared.txt"]);
    expect(diff.diffs.find((file) => file.path === "shared.txt")?.text).toBe("@@ -1 +1,2 @@\n left\n+right");
    await mergeBranch(task.folder, step.branch, "Accept combined step", task.branch);
    expect(readFileSync(path.join(task.folder, "shared.txt"), "utf8")).toBe("left\nright\n");
  });

  it("preserves a stopped resolution without committing or merging another source", async () => {
    const { task, step, later } = await conflictingSteps();
    await prepareRun(step, [task.branch], AGENT, { keepConflicts: true });
    write(step.folder, "shared.txt", "left\nright\n>>>>>>> unfinished\n");
    gitOut(step.folder, "add", "shared.txt");
    expect(gitOut(step.folder, "diff", "--name-only", "--diff-filter=U")).toBe("");
    expect(await mergeConflict(step.folder)).toEqual({ source: task.branch, files: ["shared.txt"] });
    const before = gitOut(step.folder, "rev-parse", "HEAD");
    const status = gitOut(step.folder, "status", "--porcelain");
    const marked = readFileSync(path.join(step.folder, "shared.txt"), "utf8");
    expect(await prepareRun(step, [later.branch], AGENT, { keepConflicts: true })).toEqual([]);
    const failure = prepareRun(step, [later.branch], AGENT);
    await expect(failure).rejects.toBeInstanceOf(MergeConflictError);
    await expect(failure).rejects.toMatchObject({ files: ["shared.txt"] });
    await expect(commitAll(step.folder, ["Markers are staged"], AGENT)).rejects.toBeInstanceOf(MergeConflictError);
    await expect(mergeBranch(step.folder, later.branch, "Leave resolution alone")).rejects.toBeInstanceOf(MergeConflictError);
    expect(gitOut(step.folder, "rev-parse", "HEAD")).toBe(before);
    expect(gitOut(step.folder, "status", "--porcelain")).toBe(status);
    expect(readFileSync(path.join(step.folder, "shared.txt"), "utf8")).toBe(marked);
    expect(existsSync(path.join(step.folder, "later.txt"))).toBe(false);

    write(step.folder, "shared.txt", "left\nright\n");
    gitOut(step.folder, "add", "shared.txt");
    expect(await prepareRun(step, [later.branch], AGENT, { keepConflicts: true })).toEqual([]);
    await expect(prepareRun(step, [later.branch], AGENT)).rejects.toMatchObject({ files: [] });
    expect(gitOut(step.folder, "rev-parse", "HEAD")).toBe(before);
    expect(await mergeConflict(step.folder)).toEqual({ source: task.branch, files: [] });
  });

  it("concludes a resolved merge even when its staged tree matches HEAD", async () => {
    const { task, step } = await conflictingSteps();
    await prepareRun(step, [task.branch], AGENT, { keepConflicts: true });
    const before = gitOut(step.folder, "rev-parse", "HEAD");
    const source = gitOut(step.folder, "rev-parse", "MERGE_HEAD");
    gitOut(step.folder, "read-tree", "--reset", "-u", "HEAD");
    expect(gitOut(step.folder, "diff", "--cached")).toBe("");
    expect((await mergeConflict(step.folder))?.files).toEqual([]);
    expect(await commitAll(step.folder, ["Resolve with our tree"], AGENT)).toBe(true);
    expect(gitOut(step.folder, "show", "-s", "--format=%P").split(" ")).toEqual([before, source]);
    expect(await mergeConflict(step.folder)).toBeNull();
    expect(await commitAll(step.folder, ["Nothing left"], AGENT)).toBe(false);
  });

  it("falls back to the merge head's short sha when no local branch names it", async () => {
    const { task, step } = await conflictingSteps();
    await prepareRun(step, [task.branch], AGENT, { keepConflicts: true });
    const source = gitOut(step.folder, "rev-parse", "--short", "MERGE_HEAD");
    gitOut(task.folder, "checkout", "-q", "--detach");
    gitOut(step.folder, "branch", "-D", task.branch);
    expect(await mergeConflict(step.folder)).toEqual({ source, files: ["shared.txt"] });
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

    const failure = mergeBranch(repo, tree.branch, "Merge");
    await expect(failure).rejects.toThrow(/conflicts in x\.txt/);
    await expect(failure).rejects.toBeInstanceOf(MergeConflictError);
    await expect(failure).rejects.toMatchObject({ files: ["x.txt"] });
    expect(gitOut(repo, "rev-parse", "HEAD")).toBe(before);
    expect(gitOut(repo, "status", "--porcelain")).toBe("");
  });

  it("keeps other merge failures as plain GitError without touching untracked files", async () => {
    const { repo, worktrees } = await project();
    const step = await openWorktree(repo, worktrees, "step", "feature");
    write(step.folder, "new.txt", "step\n");
    await commitAll(step.folder, ["Add new"], AGENT);
    write(repo, "new.txt", "person\n");
    const failure = mergeBranch(repo, step.branch, "Merge");
    await expect(failure).rejects.toBeInstanceOf(GitError);
    await expect(failure).rejects.not.toBeInstanceOf(MergeConflictError);
    expect(readFileSync(path.join(repo, "new.txt"), "utf8")).toBe("person\n");
    expect(await mergeConflict(repo)).toBeNull();
  });
});

describe("task branches", () => {
  it("pushes only the task branch to the base's tracking remote, with origin as fallback", async () => {
    const { repo, worktrees } = await project();
    const origin = path.join(temp(), "origin.git");
    const tracked = path.join(temp(), "tracked.git");
    gitOut(repo, "init", "--bare", "-q", origin);
    gitOut(repo, "init", "--bare", "-q", tracked);
    gitOut(repo, "remote", "add", "origin", origin);
    gitOut(repo, "remote", "add", "publish", tracked);
    const task = await openGoalWorktree(repo, worktrees, "goal", "publish");
    expect(await taskPushRemote(repo, task.target)).toBe("origin");
    gitOut(repo, "config", `branch.${task.target}.remote`, ".");
    expect(await taskPushRemote(repo, task.target)).toBe("origin");
    gitOut(repo, "config", `branch.${task.target}.remote`, "publish");
    gitOut(repo, "config", `branch.${task.target}.merge`, `refs/heads/${task.target}`);
    expect(await taskPushRemote(repo, task.target)).toBe("publish");
    write(task.folder, "done.txt", "done");
    await commitAll(task.folder, ["Done"], AGENT);
    const before = gitOut(repo, "rev-parse", "HEAD");
    // Even broad push configuration must not send the project or step branches.
    gitOut(repo, "config", "remote.publish.push", "refs/heads/*:refs/heads/*");
    await pushTaskBranch(repo, task.branch, await taskPushRemote(repo, task.target));
    expect(gitOut(tracked, "for-each-ref", "--format=%(refname)")).toBe(`refs/heads/${task.branch}`);
    expect(gitOut(tracked, "rev-parse", task.branch)).toBe(gitOut(task.folder, "rev-parse", "HEAD"));
    expect(gitOut(origin, "for-each-ref")).toBe("");
    expect(gitOut(repo, "rev-parse", "HEAD")).toBe(before);
    expect(gitOut(repo, "config", "--get-regexp", `branch.${task.branch}.*`)).not.toContain("remote");
    await expect(pushTaskBranch(repo, task.target, "publish")).rejects.toThrow("Not a Shepherd task branch");
  });

  it("refuses a missing remote without changing refs, files or the index", async () => {
    const { repo } = await project();
    write(repo, "mine.txt", "staged");
    gitOut(repo, "add", ".");
    const refs = gitOut(repo, "show-ref");
    const status = gitOut(repo, "status", "--porcelain");
    await expect(taskPushRemote(repo, "main")).rejects.toThrow(/remote origin is not available/);
    expect(gitOut(repo, "show-ref")).toBe(refs);
    expect(gitOut(repo, "status", "--porcelain")).toBe(status);
  });

  it("fails a rejected push with git's message and does not force it", async () => {
    const { repo, worktrees } = await project();
    const remote = path.join(temp(), "remote.git");
    gitOut(repo, "init", "--bare", "-q", remote);
    gitOut(repo, "remote", "add", "origin", remote);
    const task = await openGoalWorktree(repo, worktrees, "goal", "reject");
    write(task.folder, "first.txt", "first");
    await commitAll(task.folder, ["First"], AGENT);
    await pushTaskBranch(repo, task.branch, "origin");
    const remoteHead = gitOut(remote, "rev-parse", task.branch);
    gitOut(task.folder, "reset", "--hard", "HEAD~1");
    write(task.folder, "other.txt", "other");
    await commitAll(task.folder, ["Other"], AGENT);
    await expect(pushTaskBranch(repo, task.branch, "origin")).rejects.toThrow(/\[rejected\].*non-fast-forward/s);
    expect(gitOut(remote, "rev-parse", task.branch)).toBe(remoteHead);
  });

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
