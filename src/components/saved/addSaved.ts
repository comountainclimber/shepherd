import { modelName } from "../../model/models";
import { fromSaved, placeAfter } from "../../model/savedSteps";
import type { SavedPlace, SavedStep } from "../../model/types";
import { modelCatalog } from "../../runner/live";
import { useShepherd } from "../../store";
import { notify } from "../shell/Toasts";

/** Where a saved step goes when added after a step, or at the end of the outline when there is none. */
export function placeFor(projectId: string, taskId: string | null): SavedPlace {
  const { state } = useShepherd.getState();
  const place = placeAfter(state, projectId, taskId);
  const name = taskId ? state.tasks.find((task) => task.id === taskId)?.name : undefined;
  return { ...place, label: taskId ? `Adds after “${name || "Untitled step"}”` : "Adds at the end" };
}

/** Copies a saved step into the current project. The copy is the project's own from then on. */
export async function addSaved(saved: SavedStep, place: SavedPlace) {
  const store = useShepherd.getState();
  const projectId = store.ui.projectId;
  const catalog = await modelCatalog();
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const { steps, unavailable } = fromSaved(saved, projectId, place.depth, catalog, (index) => `step-${stamp}-${index}`);
  const replaced = place.replace ? store.state.tasks.find((task) => task.id === place.replace) : undefined;
  if (replaced && !replaced.name.trim() && replaced.status === "queued" && !replaced.git) store.dispatch({ type: "deleteTask", id: replaced.id });
  store.dispatch({ type: "addSteps", projectId, after: place.after, steps });
  store.setAddSaved(null);
  const first = steps[0]?.task;
  if (first) store.focusTask(first.id);
  if (unavailable.length) {
    const names = [...new Set(unavailable)].map((model) => modelName(model, catalog, "codex")).join(", ");
    notify(`Saved with ${names}, which isn't available here`, "So it uses your default model.");
  }
}
