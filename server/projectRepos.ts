import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { OrchestrationState, Project, RepositoryWorkspace } from "../src/model/types";
import { projectDirectory } from "../src/model/workspace";
import { git, inspectRepo } from "./git";

export function repoPath(value: string): string {
  const expanded = value === "~" ? homedir() : value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value;
  if (!path.isAbsolute(expanded)) throw new Error(`The repository path ${value} must be absolute, such as ~/projects/my-app.`);
  return path.normalize(expanded);
}

export async function inspectWorkspace(value: string): Promise<RepositoryWorkspace> {
  const root = realpathSync(repoPath(value));
  if (!statSync(root).isDirectory()) throw new Error(`${value} is not a directory.`);
  if (existsSync(path.join(root, ".git"))) throw new Error("Choose the parent directory containing your repositories, not a repository itself.");
  const repositories: RepositoryWorkspace["repositories"] = [];
  const gitDirectories = new Set<string>();
  for (const name of readdirSync(root).sort()) {
    if (name.startsWith(".") || !existsSync(path.join(root, name, ".git"))) continue;
    const inspected = await inspectRepo(path.join(root, name));
    if (repositories.some((item) => item.repo === inspected.repo)) throw new Error(`${name} points to a repository already included in this workspace.`);
    const gitDirectory = await commonDirectory(inspected.repo);
    if (gitDirectories.has(gitDirectory)) throw new Error(`${name} shares the same Git repository with another workspace folder. Include only one checkout of each repository.`);
    gitDirectories.add(gitDirectory);
    repositories.push({ name, repo: inspected.repo });
  }
  if (!repositories.length) throw new Error("No Git repositories found. Choose a directory whose immediate subfolders are repositories with at least one commit.");
  return { root, repositories };
}

export function directoryChoices(value: string) {
  const directory = realpathSync(repoPath(value || "~"));
  const directories = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name).sort();
  return { directory, parent: path.dirname(directory), directories };
}

export async function availableWorkspace(collection: RepositoryWorkspace, board: OrchestrationState, sandbox: string) {
  await checkLocation({ root: collection.root, checkouts: collection.repositories.map((member) => member.repo) }, board, sandbox);
  return collection;
}

interface ProjectLocation {
  root?: string;
  checkouts: string[];
}

function projectLocation(project: Project, board: OrchestrationState, sandbox: string): ProjectLocation {
  if (project.workspace) return { root: project.workspace.root, checkouts: project.workspace.repositories.map((member) => member.repo) };
  const folder = project.repo ?? path.resolve(board.workspace || sandbox, project.directory?.trim() || projectDirectory(project.name.trim(), board.projects));
  return { checkouts: [folder] };
}

async function commonDirectory(repo: string) {
  const common = await git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.code !== 0) throw new Error(`Could not check the Git directory for ${repo}: ${common.stderr}`);
  return realpathSync(common.stdout.trim());
}

async function checkLocation(candidate: ProjectLocation, board: OrchestrationState, sandbox: string, repo?: string) {
  const paths = (location: ProjectLocation) => [...(location.root ? [location.root] : []), ...location.checkouts].map(canonicalFolder);
  const candidatePaths = paths(candidate);
  let commonDirs: Set<string> | undefined;
  for (const project of board.projects) {
    const existing = projectLocation(project, board, sandbox);
    if (!candidate.root && !existing.root && repo && paths(existing).includes(repo)) {
      throw new Error(`${repo} is already the repository for ${project.name}. Open that project instead.`);
    }
    if (paths(existing).some((folder) => candidatePaths.some((incoming) => containsFolder(incoming, folder) || containsFolder(folder, incoming)))) {
      throw new Error(`An overlapping directory already belongs to ${project.name}. Open that project instead.`);
    }
    commonDirs ??= new Set(await Promise.all(candidate.checkouts.filter(hasGitDirectory).map(commonDirectory)));
    if (!commonDirs.size) continue;
    for (const checkout of existing.checkouts.filter(hasGitDirectory)) {
      if (commonDirs.has(await commonDirectory(checkout))) {
        throw new Error(`The same Git repository already belongs to ${project.name} through a linked worktree. Open that project instead.`);
      }
    }
  }
}

function hasGitDirectory(folder: string): boolean {
  return existsSync(path.join(folder, ".git"));
}

function canonicalFolder(folder: string): string {
  try { return realpathSync(folder); }
  catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    const parent = path.dirname(folder);
    if (parent === folder) throw error;
    return path.join(canonicalFolder(parent), path.basename(folder));
  }
}

function containsFolder(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Resolves aliases before comparing, so a symlink cannot add the same checkout twice. */
export async function availableRepo(value: string, board: OrchestrationState, sandbox: string) {
  const result = await inspectRepo(repoPath(value));
  await checkLocation({ checkouts: [result.repo] }, board, sandbox, result.repo);
  return result;
}

export async function validateProjectLocation(project: Project, board: OrchestrationState, sandbox: string): Promise<Project> {
  if (project.workspace) await availableWorkspace(project.workspace, board, sandbox);
  else if (project.repo !== undefined) return { ...project, repo: (await availableRepo(project.repo, board, sandbox)).repo };
  else await checkLocation(projectLocation(project, board, sandbox), board, sandbox);
  return project;
}

/**
 * Shepherd folders that are really links to a git repo outside the workspace, such as
 * .agent-sandbox/shepherd -> ~/projects/shepherd. Each comes back with the repo it points at.
 */
export function linkedRepos(board: OrchestrationState, sandbox: string): { id: string; repo: string }[] {
  let root: string;
  try { root = realpathSync(board.workspace || sandbox); } catch { return []; }
  const found: { id: string; repo: string }[] = [];
  for (const project of board.projects) {
    if (project.repo || project.workspace || !project.directory?.trim()) continue;
    let real: string;
    try { real = realpathSync(path.resolve(root, project.directory)); } catch { continue; }
    const relative = path.relative(root, real);
    const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    if (!inside && existsSync(path.join(real, ".git"))) found.push({ id: project.id, repo: real });
  }
  return found;
}
