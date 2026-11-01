import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { OrchestrationState } from "../src/model/types";
import { inspectRepo } from "./git";

export function repoPath(value: string): string {
  const expanded = value === "~" ? homedir() : value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value;
  if (!path.isAbsolute(expanded)) throw new Error(`The repository path ${value} must be absolute, such as ~/projects/my-app.`);
  return path.normalize(expanded);
}

/** Resolves aliases before comparing, so a symlink cannot add the same checkout twice. */
export async function availableRepo(value: string, state: OrchestrationState | (() => OrchestrationState), sandbox: string) {
  const result = await inspectRepo(repoPath(value));
  const board = typeof state === "function" ? state() : state;
  for (const project of board.projects) {
    const folder = project.repo ?? (project.directory ? path.resolve(board.workspace || sandbox, project.directory) : null);
    if (!folder) continue;
    let real: string;
    try { real = realpathSync(folder); } catch { continue; }
    if (real === result.repo) throw new Error(`${value} is already the repository for ${project.name}. Open that project instead.`);
  }
  return result;
}
