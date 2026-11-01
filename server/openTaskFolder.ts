import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { OrchestrationState } from "../src/model/types";

const execute = promisify(execFile);
type Launch = (command: string, args: string[]) => Promise<unknown>;

/** Only a stored task folder can be opened; request text never becomes a command or a path. */
export async function openTaskFolder(
  state: OrchestrationState,
  id: string,
  app: unknown,
  launch: Launch = (command, args) => execute(command, args, { timeout: 10_000 }),
) {
  const task = state.goals.find((goal) => goal.id === id);
  if (!task) return { error: "This task no longer exists." };
  if (app !== "cursor" && app !== "finder") return { error: "Choose cursor or finder." };
  if (!task.folder) return { error: "This task has no folder yet. Start a step first." };
  try {
    if (!(await stat(task.folder)).isDirectory()) return { error: "The task folder is not a directory." };
  } catch {
    return { error: "The task folder is missing. It may have been moved." };
  }
  try {
    await launch(app === "cursor" ? "cursor" : "open", [task.folder]);
    return { ok: true };
  } catch {
    return {
      error:
        app === "cursor"
          ? "Could not open Cursor. Install the cursor command in Cursor's Command Palette."
          : "Could not open the task folder in Finder.",
    };
  }
}
