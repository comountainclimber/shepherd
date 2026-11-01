import { acceptanceItems } from "../src/model/acceptance";
import type { Engine } from "./engine";

export function markProgress(engine: Engine, body: unknown): { ok: true } | { error: string } {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const task = engine.get().tasks.find((task) => task.id === raw.taskId);
  if (!task) return { error: "There is no such step." };
  const timeline = engine.timelines.read(task.id);
  const run = Math.max(0, ...(timeline.runs ?? []));
  if (task.runner !== "agent" || task.status !== "running" || !run || raw.run !== run || timeline.entries.some((entry) => entry.run === run && entry.kind === "run_ended")) {
    return { error: "This agent run is no longer active." };
  }
  if (typeof raw.item !== "number" || !Number.isInteger(raw.item) || raw.item < 1) return { error: "Choose a Done when item by its number." };
  const item = acceptanceItems(task.acceptance).find((item) => item.key === raw.key);
  if (!item) return { error: "That Done when item changed or was removed. Read the updated step before marking it." };
  if (typeof raw.met !== "boolean") return { error: "Say whether the item is met, as met: true or false." };
  if (raw.met && (typeof raw.note !== "string" || !raw.note.trim() || raw.note.trim().length > 500)) return { error: "Give a short note on how you know (1 to 500 characters)." };
  engine.dispatch({ type: "markAcceptance", id: task.id, key: item.key, note: raw.met ? (raw.note as string).trim() : null });
  return { ok: true };
}
