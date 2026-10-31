import { DEFAULT_AGENT_ID, newStep } from "../../model/factory";
import { outlineOf } from "../../model/outline";
import { useShepherd } from "../../store";

/** Adds a blank step to the end of the project's outline and picks it, which puts the cursor in it. */
export function appendStep(projectId: string) {
  const store = useShepherd.getState();
  const last = outlineOf(store.state, projectId).at(-1);
  const from = last ? store.state.tasks.find((task) => task.id === last.id) : undefined;
  const task = newStep(projectId, "", "", from?.runner === "agent" ? from.agentId : DEFAULT_AGENT_ID);
  store.dispatch({ type: "addSteps", projectId, after: last?.id ?? null, steps: [{ task, depth: 0 }] });
  store.setView("canvas");
  store.focusTask(task.id);
}
