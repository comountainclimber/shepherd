import { execFile, spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { codexBin } from "./runner";

export const DEFAULT_PORT = 5194;
const execute = promisify(execFile);

export function launchOptions(args: string[], env: NodeJS.ProcessEnv = process.env) {
  let port = DEFAULT_PORT;
  let open = true;
  let dataDir = env.SHEPHERD_DATA_DIR || path.join(homedir(), ".shepherd");
  let projectsDir = env.SHEPHERD_PROJECTS_DIR;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-open") open = false;
    else if (["--port", "--data-dir", "--projects-dir"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value.`);
      if (arg === "--port") {
        if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error("Choose a port from 1 to 65535.");
        port = Number(value);
      } else if (arg === "--data-dir") dataDir = value;
      else projectsDir = value;
    } else throw new Error(`Unknown option ${arg}. Run shepherd --help for usage.`);
  }
  dataDir = path.resolve(dataDir);
  return { port, open, dataDir, projectsDir: path.resolve(projectsDir || path.join(dataDir, "projects")) };
}

export async function startupWarnings(
  available: (command: string) => Promise<boolean> = async (command) => {
    try {
      await execute(command, ["--version"], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  },
) {
  const [git, codex, claude] = await Promise.all([available("git"), available(codexBin()), available("claude")]);
  return [
    ...(!git ? ["Git is missing. Install git before running steps."] : []),
    ...(!codex && !claude ? ["Neither Codex nor Claude Code is installed. Install at least one and sign in before running steps."] : []),
    ...(process.platform === "win32" ? ["Windows is not supported yet. Use macOS or Linux."] : []),
  ];
}

export function openBrowser(address: string) {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [address], { stdio: "ignore", detached: true });
  const failed = () => console.warn("Could not open a browser. Open the address printed above.");
  child.once("error", failed);
  child.once("exit", (code) => { if (code) failed(); });
  child.unref();
}
