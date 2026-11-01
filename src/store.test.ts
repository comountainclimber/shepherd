import { afterEach, describe, expect, it, vi } from "vitest";
import { blankGoal, newStep } from "./model/factory";
import { reducer } from "./model/reducer";
import type { OrchestrationState } from "./model/types";
import { workspace } from "./model/workspace";
import { connectToServer, initialUi, useShepherd } from "./store";

function board() {
  let state = reducer(workspace(1), { type: "createGoal", goal: blankGoal("proj-local", "Other task", "second") });
  const task = { ...newStep("proj-local", "Other step", "", "agent-codex", "second"), id: "step-other" };
  state = reducer(state, { type: "addSteps", goalId: "second", after: null, steps: [{ task, depth: 0 }] });
  return state;
}

afterEach(() => {
  vi.unstubAllGlobals();
  useShepherd.setState({ state: workspace(1), ui: initialUi, loaded: false });
});

describe("task selection", () => {
  it("selects a task alongside its project and clears the previous step and picker", () => {
    useShepherd.setState({ state: board(), ui: { ...initialUi, selectedTaskId: "old", inspectorOpen: true, addSaved: { after: null, depth: 0, label: "Old task" } } });
    useShepherd.getState().setGoal("second");
    expect(useShepherd.getState().ui).toMatchObject({ projectId: "proj-local", goalId: "second", selectedTaskId: null, inspectorOpen: false, addSaved: null });
    useShepherd.getState().openTask("step-other", "output");
    expect(useShepherd.getState().ui).toMatchObject({ goalId: "second", selectedTaskId: "step-other", inspectorOpen: true, panelTab: "output" });
  });

  it("reconciles removed tasks on server updates without opening an inspector while typing", () => {
    let stream: { onmessage?: (message: { data: string }) => void };
    vi.stubGlobal("EventSource", class {
      onmessage?: (message: { data: string }) => void;
      constructor() { stream = this; }
      close() {}
    });
    const disconnect = connectToServer();
    const receive = (state: OrchestrationState, revision: number) => stream.onmessage?.({ data: JSON.stringify({ revision, state }) });
    const state = board();
    useShepherd.setState({ state, ui: { ...initialUi, goalId: "second", selectedTaskId: "step-other", inspectorOpen: false } });
    receive(state, 1);
    expect(useShepherd.getState().ui).toMatchObject({ goalId: "second", selectedTaskId: "step-other", inspectorOpen: false });
    receive(reducer(state, { type: "deleteGoal", id: "second" }), 2);
    expect(useShepherd.getState().ui).toMatchObject({ goalId: "goal-proj-local", selectedTaskId: null, inspectorOpen: false });
    disconnect();
  });
});

it("clears task-specific filters, agent selection and draft text when switching tasks", () => {
  useShepherd.setState({ state: board(), ui: { ...initialUi, selectedAgentId: "agent-codex", draftToken: 3, draftSeed: "Old task goal", filters: { ...initialUi.filters, search: "Old step", savedView: "needs-me" } } });
  useShepherd.getState().setGoal("second");
  expect(useShepherd.getState().ui).toMatchObject({ selectedAgentId: null, filters: initialUi.filters, draftToken: 0, draftSeed: "" });
});
