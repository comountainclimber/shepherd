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
  platform: NodeJS.Platform = process.platform,
) {
  const task = state.goals.find((goal) => goal.id === id);
  if (!task) return { error: "This task no longer exists." };
  if (app !== "cursor" && app !== "finder") return { error: "Choose cursor or finder." };
  if (platform !== "darwin") return { error: `${app === "cursor" ? "Opening Cursor" : "Finder"} from Shepherd is only available on macOS. Copy the task folder path and open it yourself.` };
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
