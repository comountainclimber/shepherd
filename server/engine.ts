import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { interruptWork, loadState } from "../src/model/migrate";
import { reducer } from "../src/model/reducer";
import type { Action, OrchestrationState } from "../src/model/types";
import { workspace } from "../src/model/workspace";

/** Edits a tab may send. Run lifecycle actions (running, checks, merges) only come from the server. */
export const TAB_ACTIONS = new Set<Action["type"]>([
  "moveTask",
  "connect",
  "disconnect",
  "createProject",
  "createTask",
  "updateTask",
  "setCheck",
  "setCheckCommand",
  "reassign",
  "deleteTask",
  "approvePlan",
  "reset",
  "dismissNotification",
  "readNotifications",
  "setWorkspace",
  "instruct",
]);

/** Fields of a task a tab may edit directly. The rest change only through runs, checks and merges. */
const EDITABLE = new Set(["name", "objective", "description", "acceptance", "autoRun", "independent"]);

export interface Engine {
  get(): OrchestrationState;
  version(): number;
  dispatch(action: Action): OrchestrationState;
  subscribe(listener: () => void): () => void;
  /** Writes pending changes now. */
  flush(): void;
  /** Writes pending changes, then ignores every later action, so a replaced server cannot overwrite the board. */
  close(): void;
}

const WRITE_DELAY_MS = 150;
const BACKUP_EVERY_MS = 60_000;
const BACKUP_LIMIT = 30;

export function createEngine(file: string, clock: () => number = () => Date.now()): Engine {
  let state = interruptWork(load(file));
  let version = 1;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastBackupAt = 0;
  let closed = false;
  const listeners = new Set<() => void>();

  const write = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    mkdirSync(path.dirname(file), { recursive: true });
    lastBackupAt = backup(file, state, lastBackupAt, clock());
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(envelope(state)));
    renameSync(temp, file);
  };
  write();

  return {
    get: () => state,
    version: () => version,
    dispatch(action) {
      if (closed) return state;
      const input = { ...state, now: clock() };
      const next = reducer(input, action);
      if (next === input) return state;
      state = next;
      version += 1;
      timer ??= setTimeout(write, WRITE_DELAY_MS);
      for (const listener of listeners) listener();
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush() {
      if (timer) write();
    },
    close() {
      if (timer) write();
      closed = true;
      listeners.clear();
    },
  };
}

/** Rejects actions a tab must not send, so a stale or hostile tab cannot fake a passing check. */
export function tabAction(state: OrchestrationState, value: unknown): Action | { error: string } {
  const action = value && typeof value === "object" ? (value as Action) : null;
  if (!action || typeof action.type !== "string") return { error: "Send an action with a type." };
  if (!TAB_ACTIONS.has(action.type)) return { error: `A tab cannot send ${action.type}; the server does that itself.` };
  if (action.type === "updateTask") {
    const blocked = Object.keys(action.patch ?? {}).filter((key) => !EDITABLE.has(key));
    if (blocked.length) return { error: `A tab cannot change ${blocked.join(", ")} directly.` };
  }
  if (action.type === "setCheck") {
    const check = state.tasks.find((task) => task.id === action.taskId)?.verification.find((item) => item.id === action.checkId);
    if (check && check.kind !== "review") return { error: "Only reviews are accepted or rejected by hand. Checks pass by running." };
  }
  const created = action.type === "createTask" ? [action.task] : action.type === "approvePlan" ? action.tasks : [];
  if (created.some((task) => task.git || task.status === "running" || task.verification.some((check) => check.state !== "pending"))) {
    return { error: "A new task starts unverified, with no branch." };
  }
  return action;
}

export function envelope(state: OrchestrationState) {
  return { state: { state }, version: 2 };
}

function load(file: string): OrchestrationState {
  if (!existsSync(file)) return workspace();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    raw = undefined;
  }
  const saved = (raw as { state?: { state?: unknown } } | undefined)?.state?.state;
  const state = loadState(saved);
  if (state) return state;
  if (saved && typeof saved === "object" && Array.isArray((saved as { tasks?: unknown }).tasks)) {
    // Not the demo board and not readable: keep it rather than writing an empty board over it.
    const aside = `${file}.unreadable-${new Date(Date.now()).toISOString().replace(/[:.]/g, "-")}`;
    renameSync(file, aside);
    console.warn(`[shepherd] Could not read ${file}; moved it to ${aside} and started an empty board.`);
  }
  return workspace();
}

function taskCount(body: unknown): number {
  const tasks = (body as { state?: { state?: { tasks?: unknown } } } | null)?.state?.state?.tasks;
  return Array.isArray(tasks) ? tasks.length : 0;
}

/** Keeps a copy of the previous file every minute, and always before a write that drops tasks. */
function backup(file: string, next: OrchestrationState, lastAt: number, now: number): number {
  let previous: unknown;
  try {
    previous = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return lastAt;
  }
  const shrinking = next.tasks.length < taskCount(previous);
  if (!shrinking && now - lastAt < BACKUP_EVERY_MS) return lastAt;
  const dir = path.join(path.dirname(file), "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  writeFileSync(path.join(dir, `state-${stamp}.json`), JSON.stringify(previous));
  const stale = readdirSync(dir)
    .filter((name) => name.startsWith("state-"))
    .sort()
    .slice(0, -BACKUP_LIMIT);
  for (const name of stale) rmSync(path.join(dir, name));
  return now;
}
