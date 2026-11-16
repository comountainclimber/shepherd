import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { OrchestrationState, RepositoryWorkspace } from "../src/model/types";
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
    const common = await git(inspected.repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (common.code !== 0) throw new Error(`Could not check the Git directory for ${name}: ${common.stderr}`);
    const gitDirectory = realpathSync(common.stdout.trim());
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

export function availableWorkspace(collection: RepositoryWorkspace, board: OrchestrationState, sandbox: string) {
  const imported = [collection.root, ...collection.repositories.map((member) => member.repo)].map(canonicalFolder);
  for (const project of board.projects) {
    const folders = project.workspace
      ? [project.workspace.root, ...project.workspace.repositories.map((member) => member.repo)]
      : [project.repo ?? (project.directory ? path.resolve(board.workspace || sandbox, project.directory) : "")];
    for (const folder of folders) {
      if (!folder) continue;
      const existing = canonicalFolder(folder);
      if (imported.some((directory) => containsFolder(directory, existing) || containsFolder(existing, directory))) {
        throw new Error(`An overlapping directory already belongs to ${project.name}. Open that project instead.`);
      }
    }
  }
  return collection;
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
export async function availableRepo(value: string, state: OrchestrationState | (() => OrchestrationState), sandbox: string) {
  const result = await inspectRepo(repoPath(value));
  const board = typeof state === "function" ? state() : state;
  for (const project of board.projects) {
    if (project.workspace?.repositories.some((member) => member.repo === result.repo)) {
      throw new Error(`${value} already belongs to workspace ${project.name}. Open that project instead.`);
    }
    const folder = project.repo ?? (project.directory ? path.resolve(board.workspace || sandbox, project.directory) : null);
    if (!folder) continue;
    let real: string;
    try { real = realpathSync(folder); } catch { continue; }
    if (real === result.repo) throw new Error(`${value} is already the repository for ${project.name}. Open that project instead.`);
  }
  return result;
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
