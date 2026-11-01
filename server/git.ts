import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export class GitError extends Error {}
export class DirtyWorktreeError extends GitError {}

export interface Author {
  name: string;
  email: string;
}

export interface Worktree {
  repo: string;
  branch: string;
  folder: string;
  /** The branch this worktree starts from and merges into. */
  target: string;
}

export interface Changes {
  head: string;
  files: string[];
  diffs: { path: string; text: string }[];
}

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

const SHEPHERD: Author = { name: "Shepherd", email: "shepherd@localhost" };
// Shepherd's own commits must not run the repository's hooks or wait on a signing prompt.
const BASE_ARGS = ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-c", "core.quotepath=false"];
const NAME = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const BRANCH = /^(shepherd|shepherd-step)\/[a-z0-9][a-z0-9._-]{0,90}$/i;
const FILE_LIMIT = 12_000;
const TOTAL_LIMIT = 80_000;
const MAX_FILES = 40;

export function isTaskName(name: string): boolean {
  return NAME.test(name);
}

export function isTaskBranch(branch: string): boolean {
  return BRANCH.test(branch);
}

export function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn("git", [...BASE_ARGS, ...args], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => resolve({ code: -1, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function lastLine(text: string): string {
  return text.trim().split("\n").at(-1) ?? "";
}

async function must(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await git(cwd, args, env);
  if (result.code !== 0) throw new GitError(`git ${args[0]} failed: ${lastLine(result.stderr || result.stdout)}`);
  return result.stdout.trim();
}

function identity(author: Author = SHEPHERD): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: SHEPHERD.name,
    GIT_COMMITTER_EMAIL: SHEPHERD.email,
  };
}

async function userIdentity(repo: string): Promise<NodeJS.ProcessEnv> {
  const email = await git(repo, ["config", "user.email"]);
  return email.code === 0 && email.stdout.trim() ? {} : identity();
}

/** Who to credit for changes a person made by hand: their git identity, or a plain stand-in. */
export async function personAuthor(repo: string): Promise<Author> {
  const [name, email] = await Promise.all([git(repo, ["config", "user.name"]), git(repo, ["config", "user.email"])]);
  return {
    name: (name.code === 0 && name.stdout.trim()) || "You",
    email: (email.code === 0 && email.stdout.trim()) || "you@shepherd.local",
  };
}

const queues = new Map<string, Promise<unknown>>();

/** Runs git work for one repository at a time, so parallel runs do not race on its locks and refs. */
export function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const result = (queues.get(key) ?? Promise.resolve()).then(work, work);
  queues.set(key, result.catch(() => undefined));
  return result;
}

export async function gitAvailable(): Promise<boolean> {
  return (await git(process.cwd(), ["--version"])).code === 0;
}

/** Read-only: a supplied repository must already have a checkout and a commit. */
export async function inspectRepo(dir: string): Promise<{ repo: string; branch: string }> {
  let real: string;
  try {
    if (!statSync(dir).isDirectory()) throw new Error();
    real = realpathSync(dir);
  } catch {
    throw new GitError(`The repository path ${dir} does not exist or is not a folder.`);
  }
  const top = await git(real, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) throw new GitError(`${dir} is not a git repository. Choose a repository with at least one commit.`);
  if (realpathSync(top.stdout.trim()) !== real) {
    throw new GitError(`${dir} is inside a git repository. Use its top folder, ${top.stdout.trim()}.`);
  }
  if ((await git(real, ["rev-parse", "--verify", "-q", "HEAD^{commit}"])).code !== 0) {
    throw new GitError(`${dir} has no commits. Make a first commit before adding it to Shepherd.`);
  }
  const branch = (await currentBranch(real)) ?? `detached at ${await must(real, ["rev-parse", "--short", "HEAD"])}`;
  return { repo: real, branch };
}

/** Makes `dir` the top of a git repository with at least one commit, and returns its real path. */
export async function ensureRepo(dir: string): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const real = realpathSync(dir);
  const top = await git(real, ["rev-parse", "--show-toplevel"]);
  const topPath = top.code === 0 ? realpathSync(top.stdout.trim()) : null;
  if (topPath !== real) {
    if (topPath && (await git(topPath, ["check-ignore", "-q", `${path.relative(topPath, real)}/`])).code !== 0) {
      throw new GitError(`${real} is inside the git repository ${topPath}. Use ${topPath} as the project folder instead.`);
    }
    await must(real, ["init", "-q"]);
    mkdirSync(path.join(real, ".git", "info"), { recursive: true });
    appendFileSync(path.join(real, ".git", "info", "exclude"), "node_modules/\n.DS_Store\n");
  }
  if ((await git(real, ["rev-parse", "--verify", "-q", "HEAD"])).code !== 0) {
    await must(real, ["add", "-A"]);
    await must(real, ["commit", "-q", "--allow-empty", "-m", "Shepherd: initial commit"], identity());
  }
  return real;
}

export function worktreeFolder(root: string, repo: string, branch: string): string {
  const key = `${path.basename(repo)}-${createHash("sha1").update(repo).digest("hex").slice(0, 8)}`;
  const folder = branch.startsWith("shepherd-step/") ? branch.replace(/^shepherd-step\//, "step-") : branch.replace(/^shepherd\//, "");
  return path.join(root, key, folder);
}

function baseRef(branch: string): string {
  return `refs/shepherd-base/${branch}`;
}

async function exists(cwd: string, ref: string): Promise<boolean> {
  return (await git(cwd, ["rev-parse", "--verify", "-q", ref])).code === 0;
}

async function contains(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  return (await git(cwd, ["merge-base", "--is-ancestor", ancestor, descendant])).code === 0;
}

async function currentBranch(repo: string): Promise<string | null> {
  const result = await git(repo, ["symbolic-ref", "--short", "-q", "HEAD"]);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function ownerOf(repo: string, branch: string): Promise<string | null> {
  const result = await git(repo, ["config", "--get", `branch.${branch}.shepherdtask`]);
  return result.code === 0 ? result.stdout.trim() : null;
}

async function conflicts(cwd: string): Promise<string[]> {
  const result = await git(cwd, ["diff", "--name-only", "--diff-filter=U"]);
  return result.stdout.split("\n").filter(Boolean);
}

/**
 * Finds or creates the task's branch and worktree. A task keeps its branch across runs, and a new
 * task never inherits a branch another task (or an earlier board) left behind.
 */
export async function openWorktree(
  repo: string, root: string, taskId: string, name: string, branch?: string,
  options: { start?: string; prefix?: "shepherd" | "shepherd-step" } = {},
): Promise<Worktree> {
  if (!NAME.test(name)) throw new GitError(`Not a usable folder name: ${name}`);
  const target = options.start ?? (await currentBranch(repo)) ?? "HEAD";
  const prefix = options.prefix ?? "shepherd";
  if (await exists(repo, `refs/heads/${prefix}`)) throw new GitError(`The branch ${prefix} prevents creating ${prefix}/ branches. Rename it first.`);
  let chosen: string | null = null;
  if (branch && BRANCH.test(branch) && (await exists(repo, `refs/heads/${branch}`)) && (await ownerOf(repo, branch)) === taskId) {
    chosen = branch;
  }
  for (let index = 1; !chosen; index += 1) {
    const candidate = index === 1 ? `${prefix}/${name}` : `${prefix}/${name}-${index}`;
    if (!(await exists(repo, `refs/heads/${candidate}`)) && !(await must(repo, ["for-each-ref", "--format=%(refname)", `refs/heads/${candidate}/`])) && !existsSync(worktreeFolder(root, repo, candidate))) {
      const folder = worktreeFolder(root, repo, candidate);
      await must(repo, ["worktree", "prune"]);
      mkdirSync(path.dirname(folder), { recursive: true });
      await must(repo, ["worktree", "add", "-q", "-b", candidate, folder, target]);
      await must(repo, ["config", `branch.${candidate}.shepherdtask`, taskId]);
      await must(repo, ["update-ref", baseRef(candidate), target]);
      return { repo, branch: candidate, folder, target };
    }
    if ((await ownerOf(repo, candidate)) === taskId) chosen = candidate;
  }
  const folder = worktreeFolder(root, repo, chosen);
  if ((await currentBranch(repo)) === chosen) throw new GitError(`${repo} has ${chosen} checked out. Switch the project checkout to another branch before running this step.`);
  if (!existsSync(path.join(folder, ".git"))) {
    await must(repo, ["worktree", "prune"]);
    mkdirSync(path.dirname(folder), { recursive: true });
    await must(repo, ["worktree", "add", "-q", folder, chosen]);
  }
  if (!(await exists(repo, baseRef(chosen)))) {
    await must(repo, ["update-ref", baseRef(chosen), await must(repo, ["merge-base", target, chosen])]);
  }
  if ((await currentBranch(folder)) !== chosen) throw new GitError(`${folder} is no longer on ${chosen}. Switch it back before running this step.`);
  return { repo, branch: chosen, folder, target };
}

/** Commits everything in the worktree. Returns false when there was nothing to commit. */
export async function commitAll(folder: string, message: string[], author: Author): Promise<boolean> {
  const branch = await currentBranch(folder);
  if (!branch || !BRANCH.test(branch) || !(await ownerOf(folder, branch))) {
    throw new GitError(`Shepherd cannot commit in ${folder}: its checked-out branch was not created by Shepherd.`);
  }
  await must(folder, ["add", "-A"]);
  if ((await git(folder, ["diff", "--cached", "--quiet"])).code === 0) return false;
  await must(folder, ["commit", "-q", ...message.filter(Boolean).flatMap((part) => ["-m", part])], identity(author));
  return true;
}

/**
 * Moves the diff base past newly merged upstream work, so the task's diff keeps showing only what
 * the task itself changed.
 */
async function advanceBase(folder: string, branch: string, upstream: string, taskBranch: boolean): Promise<void> {
  const ref = baseRef(branch);
  const base = await must(folder, ["rev-parse", ref]);
  const accepted = `refs/shepherd-accepted/${branch}`;
  // The task branch includes this step's accepted work. Remove that contribution from the
  // incoming diff base, or rerunning the step would erase its own diff from the board.
  if (taskBranch && await exists(folder, accepted) && await contains(folder, accepted, upstream)) {
    const stripped = await git(folder, ["merge-tree", "--write-tree", `--merge-base=${accepted}`, base, upstream]);
    if (stripped.code === 0) {
      const tree = stripped.stdout.trim().split("\n")[0]!;
      const commit = await must(folder, ["commit-tree", tree, "-p", base, "-p", upstream, "-m", "Shepherd: diff base after task work"], identity());
      await must(folder, ["update-ref", ref, commit]);
      return;
    }
  }
  if (await contains(folder, upstream, base)) return;
  if (await contains(folder, base, upstream)) {
    await must(folder, ["update-ref", ref, upstream]);
    return;
  }
  const merged = await git(folder, ["merge-tree", "--write-tree", base, upstream]);
  if (merged.code !== 0) {
    await must(folder, ["update-ref", ref, "HEAD"]);
    return;
  }
  const tree = merged.stdout.trim().split("\n")[0]!;
  const commit = await must(folder, ["commit-tree", tree, "-p", base, "-p", upstream, "-m", `Shepherd: diff base after ${upstream}`], identity());
  await must(folder, ["update-ref", ref, commit]);
}

/**
 * Gets the worktree ready for a run: commits anything a stopped run left behind, then merges in
 * upstream task branches. Returns the branches it merged.
 */
export async function prepareRun(worktree: Worktree, upstream: string[], author: Author): Promise<string[]> {
  const { folder, branch } = worktree;
  await commitAll(folder, ["Shepherd: changes left by a stopped run"], author);
  const merged: string[] = [];
  for (const source of upstream) {
    if (!BRANCH.test(source) || source === branch || !(await exists(folder, `refs/heads/${source}`))) continue;
    if (await contains(folder, source, "HEAD")) continue;
    const result = await git(folder, ["merge", "--no-edit", "-m", `Shepherd: bring in ${source}`, source], identity());
    if (result.code !== 0) {
      const files = await conflicts(folder);
      await git(folder, ["merge", "--abort"]);
      throw new GitError(
        files.length
          ? `Could not merge ${source} into ${branch}: both changed ${files.join(", ")}.`
          : `Could not merge ${source} into ${branch}: ${lastLine(result.stderr || result.stdout)}`,
      );
    }
    await advanceBase(folder, branch, source, source === worktree.target);
    merged.push(source);
  }
  return merged;
}

function trimDiff(text: string, limit: number): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith("@@") || line.startsWith("Binary files"));
  const body = (start >= 0 ? lines.slice(start) : lines).join("\n").trimEnd();
  return body.length > limit ? `${body.slice(0, limit)}\n… cut off at ${limit} characters` : body;
}

/** What the task changed on its branch, not counting upstream work merged into it. */
export async function changes(folder: string, branch: string, diffBase?: string): Promise<Changes> {
  const base = diffBase ?? baseRef(branch);
  const head = await must(folder, ["rev-parse", "--short", "HEAD"]);
  const files = (await must(folder, ["diff", "--name-only", "--no-renames", base, "HEAD"])).split("\n").filter(Boolean);
  const diffs: Changes["diffs"] = [];
  let budget = TOTAL_LIMIT;
  for (const file of files.slice(0, MAX_FILES)) {
    if (budget <= 0) break;
    const result = await git(folder, ["diff", "--no-color", "--no-ext-diff", "--no-renames", base, "HEAD", "--", file]);
    const text = trimDiff(result.stdout, Math.min(FILE_LIMIT, budget));
    budget -= text.length;
    diffs.push({ path: file, text });
  }
  return { head, files, diffs };
}

/** Merges into a clean checkout, optionally requiring its expected branch. */
export async function mergeBranch(repo: string, branch: string, message: string, expectedInto?: string): Promise<{ into: string; sha: string }> {
  if (!BRANCH.test(branch) || !(await exists(repo, `refs/heads/${branch}`))) {
    throw new GitError(`The branch ${branch} no longer exists.`);
  }
  const into = await currentBranch(repo);
  if (expectedInto && into !== expectedInto) throw new GitError(`${repo} is no longer on ${expectedInto}. Switch it back before merging.`);
  if (!into) throw new GitError(`${repo} is not on a branch, so there is nothing to merge into.`);
  if (await contains(repo, branch, "HEAD")) return { into, sha: await must(repo, ["rev-parse", "--short", "HEAD"]) };
  if (await must(repo, ["status", "--porcelain", "--untracked-files=no"])) {
    throw new DirtyWorktreeError(`${repo} has uncommitted changes on ${into}. Commit or stash them, then merge again.`);
  }
  const result = await git(repo, ["merge", "--no-ff", "--no-edit", "-m", message, branch], await userIdentity(repo));
  if (result.code !== 0) {
    const files = await conflicts(repo);
    await git(repo, ["merge", "--abort"]);
    throw new GitError(
      files.length
        ? `Merging ${branch} into ${into} conflicts in ${files.join(", ")}. Nothing was changed.`
        : `Could not merge ${branch} into ${into}: ${lastLine(result.stderr || result.stdout)}`,
    );
  }
  return { into, sha: await must(repo, ["rev-parse", "--short", "HEAD"]) };
}

/** A task keeps its original base even if the project later checks out another branch. */
export async function openGoalWorktree(repo: string, root: string, goalId: string, name: string, saved?: { branch?: string; base?: string }): Promise<Worktree> {
  repo = realpathSync(repo);
  const base = saved?.base ?? await currentBranch(repo);
  if (!base) throw new GitError(`${repo} is not on a branch. Check out a branch before starting this task.`);
  if (saved?.branch && (!(await exists(repo, `refs/heads/${saved.branch}`)) || await ownerOf(repo, saved.branch) !== `goal:${goalId}`)) {
    throw new GitError(`The task branch ${saved.branch} is missing or no longer belongs to this task.`);
  }
  return openWorktree(repo, root, `goal:${goalId}`, name, saved?.branch, { start: base });
}

export async function head(folder: string): Promise<string> {
  return must(folder, ["rev-parse", "HEAD"]);
}

/** Records exactly which step work the task branch has accepted, for subsequent diff updates. */
export async function markAccepted(repo: string, branch: string): Promise<void> {
  await must(repo, ["update-ref", `refs/shepherd-accepted/${branch}`, `refs/heads/${branch}`]);
}
