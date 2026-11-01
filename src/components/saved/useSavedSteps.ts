import { useEffect, useSyncExternalStore } from "react";
import { readSavedSteps } from "../../model/savedSteps";
import type { SavedStep } from "../../model/types";
import { useShepherd } from "../../store";

let steps: SavedStep[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function load(): Promise<void> {
  loading ??= fetch("/api/saved-steps")
    .then((response) => (response.ok ? (response.json() as Promise<{ steps?: unknown }>) : Promise.reject(new Error())))
    .then((body) => {
      steps = readSavedSteps(body.steps);
      emit();
    })
    .catch(() => {
      steps ??= [];
      emit();
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") window.addEventListener("focus", () => void load());

/** Your saved steps, or null until the server says. Another tab's changes arrive when this one gets focus. */
export function useSavedSteps(): SavedStep[] | null {
  const value = useSyncExternalStore(subscribe, () => steps);
  useEffect(() => {
    if (!steps) void load();
  }, []);
  return value;
}

export function savedSteps(): SavedStep[] {
  return steps ?? [];
}

/** Saves the whole list. It shows at once, and goes back if the server refuses. */
export async function putSavedSteps(next: SavedStep[]): Promise<boolean> {
  const before = steps;
  steps = next;
  emit();
  try {
    const response = await fetch("/api/saved-steps", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ steps: next }),
    });
    const body = (await response.json()) as { steps?: unknown; error?: string };
    if (!response.ok) throw new Error(body.error ?? `The server refused (${response.status}).`);
    steps = readSavedSteps(body.steps);
    emit();
    return true;
  } catch (error) {
    steps = before;
    emit();
    useShepherd.getState().setProblem(`Could not save your saved steps. ${error instanceof Error ? error.message : ""}`.trim());
    return false;
  }
}
