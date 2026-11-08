import { afterEach, describe, expect, it, vi } from "vitest";
import { blankGoal, newStep } from "./model/factory";
import { reducer } from "./model/reducer";
import type { OrchestrationState, UiState } from "./model/types";
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

async function browser(pathname: string, saved: Partial<UiState> = {}) {
  vi.resetModules();
  const location = { pathname };
  const entries = [pathname];
  let index = 0;
  const window = new EventTarget();
  const history = {
    pushState: vi.fn((_data: unknown, _title: string, path: string) => {
      entries.splice(index + 1, entries.length, path);
      index += 1;
      location.pathname = path;
    }),
    replaceState: vi.fn((_data: unknown, _title: string, path: string) => {
      entries[index] = path;
      location.pathname = path;
    }),
    back: () => {
      if (index === 0) return;
      location.pathname = entries[--index];
      window.dispatchEvent(new Event("popstate"));
    },
    forward: () => {
      if (index === entries.length - 1) return;
      location.pathname = entries[++index];
      window.dispatchEvent(new Event("popstate"));
    },
  };
  const localStorage = {
    getItem: vi.fn(() => JSON.stringify(saved)),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
  let stream!: { onmessage?: (message: { data: string }) => void };
  vi.stubGlobal("window", window);
  vi.stubGlobal("location", location);
  vi.stubGlobal("history", history);
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("EventSource", class {
    onmessage?: (message: { data: string }) => void;
    constructor() { stream = this; }
    close() {}
  });
  const { useShepherd, connectToServer } = await import("./store");
  connectToServer();
  const receive = (state = board(), revision = 1) => stream.onmessage?.({ data: JSON.stringify({ revision, state }) });
  return { store: useShepherd, location, history, localStorage, receive, window, entries };
}

describe("address and place", () => {
  it.each([
    ["/t/second", "canvas", null, "step"],
    ["/t/second/agents", "agents", null, "step"],
    ["/t/second/s/step-other", "canvas", "step-other", "step"],
    ["/t/second/s/step-other/output", "canvas", "step-other", "output"],
    ["/t/second/s/step-other/checks", "canvas", "step-other", "checks"],
    ["/t/second/s/step-other/log", "canvas", "step-other", "log"],
  ])("opens %s when the first board arrives", async (path, view, stepId, tab) => {
    const { store, receive, history, location } = await browser(path);
    expect(store.getState().loaded).toBe(false);
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(history.pushState).not.toHaveBeenCalled();
    receive();
    expect(store.getState().ui).toMatchObject({ projectId: "proj-local", goalId: "second", view, selectedTaskId: stepId, inspectorOpen: !!stepId, panelTab: tab });
    expect(location.pathname).toBe(path);
    expect(history.pushState).not.toHaveBeenCalled();
    expect(history.replaceState).not.toHaveBeenCalled();
    store.getState().setView(view === "canvas" ? "agents" : "canvas");
    receive(board(), 2);
    expect(store.getState().ui.view).not.toBe(view);
  });

  it("follows the task's project instead of the restored project", async () => {
    const { store, receive } = await browser("/t/remote/s/remote-step/checks");
    let state = reducer(board(), { type: "createProject", project: { id: "remote-project", name: "Other project", summary: "" } });
    state = reducer(state, { type: "createGoal", goal: blankGoal("remote-project", "Remote task", "remote") });
    const task = { ...newStep("remote-project", "Remote step", "", "agent-codex", "remote"), id: "remote-step" };
    state = reducer(state, { type: "addSteps", goalId: "remote", after: null, steps: [{ task, depth: 0 }] });
    receive(state);
    expect(store.getState().ui).toMatchObject({ projectId: "remote-project", goalId: "remote", selectedTaskId: "remote-step", panelTab: "checks", inspectorOpen: true });
  });

  it.each(["/", "/not-a-route", "/t/missing", "/t/missing/s/step-other"])("keeps the restored place and repairs %s", async (path) => {
    const { store, receive, location, history } = await browser(path, { goalId: "second", view: "agents", selectedTaskId: "step-other" });
    receive();
    expect(store.getState().ui).toMatchObject({ goalId: "second", view: "agents", selectedTaskId: "step-other", inspectorOpen: false });
    expect(location.pathname).toBe("/t/second/agents");
    expect(history.replaceState).toHaveBeenCalledExactlyOnceWith(null, "", "/t/second/agents");
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it.each(["missing-step", "step-other"])("does not open %s outside the linked task", async (stepId) => {
    const { store, receive, location, history } = await browser(`/t/goal-proj-local/s/${stepId}/log`);
    receive();
    expect(store.getState().ui).toMatchObject({ goalId: "goal-proj-local", selectedTaskId: null, inspectorOpen: false });
    expect(location.pathname).toBe("/t/goal-proj-local");
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it("reconciles a removed saved task before repairing the address", async () => {
    const { store, receive, location } = await browser("/t/missing", { goalId: "removed", selectedTaskId: "removed-step" });
    receive();
    expect(store.getState().ui).toMatchObject({ goalId: "goal-proj-local", selectedTaskId: null, inspectorOpen: false });
    expect(location.pathname).toBe("/t/goal-proj-local");
  });

  it("normalizes encoded ids, trailing slashes and unknown tabs", async () => {
    const { store, receive, location, history } = await browser("/t/second%20task/s/step%2Fother/unknown/");
    const state = board();
    state.goals.find((goal) => goal.id === "second")!.id = "second task";
    state.tasks[0] = { ...state.tasks[0], id: "step/other", goalId: "second task" };
    receive(state);
    expect(store.getState().ui).toMatchObject({ goalId: "second task", selectedTaskId: "step/other", panelTab: "step", inspectorOpen: true });
    expect(location.pathname).toBe("/t/second%20task/s/step%2Fother");
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it("pushes task, view and open-step changes, and replaces tabs and panel closure", async () => {
    const { store, receive, history, location, localStorage } = await browser("/t/goal-proj-local");
    const state = board();
    const task = { ...newStep("proj-local", "Another step", "", "agent-codex", "second"), id: "step-next" };
    receive(reducer(state, { type: "addSteps", goalId: "second", after: null, steps: [{ task, depth: 0 }] }));
    const ui = store.getState();
    ui.setGoal("second");
    ui.setView("agents");
    ui.setView("canvas");
    ui.focusTask("step-other");
    expect(location.pathname).toBe("/t/second");
    ui.openTask("step-other", "step");
    ui.setPanelTab("output");
    expect(location.pathname).toBe("/t/second/s/step-other/output");
    ui.focusTask("step-next");
    ui.setInspectorOpen(false);
    expect(location.pathname).toBe("/t/second");
    expect(history.pushState.mock.calls.map((call) => call[2])).toEqual([
      "/t/second", "/t/second/agents", "/t/second", "/t/second/s/step-other", "/t/second/s/step-next/output",
    ]);
    expect(history.replaceState.mock.calls.map((call) => call[2])).toEqual(["/t/second/s/step-other/output", "/t/second"]);
    expect(JSON.parse(localStorage.setItem.mock.lastCall![1])).toEqual({ view: "canvas", projectId: "proj-local", goalId: "second", selectedTaskId: "step-next" });
    const writes = localStorage.setItem.mock.calls.length;
    ui.setPanelTab("log");
    expect(localStorage.setItem).toHaveBeenCalledTimes(writes);
  });

  it("does nothing when the path is already current or the place did not change", async () => {
    const { store, receive, history } = await browser("/t/second/s/step-other/log");
    receive();
    const ui = store.getState();
    ui.openTask("step-other", "log");
    ui.setView("canvas");
    ui.setPanelTab("log");
    ui.setPaletteOpen(true);
    ui.setFilters({ search: "Other" });
    expect(history.pushState).not.toHaveBeenCalled();
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("restores the task, view, step and replaced tab with Back and Forward", async () => {
    const { store, receive, history, location, entries } = await browser("/t/goal-proj-local");
    receive();
    const ui = store.getState();
    ui.setGoal("second");
    ui.setView("agents");
    ui.openTask("step-other", "step");
    ui.setPanelTab("checks");
    history.back();
    expect(store.getState().ui).toMatchObject({ goalId: "second", view: "agents", selectedTaskId: null, inspectorOpen: false });
    history.back();
    expect(store.getState().ui).toMatchObject({ goalId: "second", view: "canvas", selectedTaskId: null, inspectorOpen: false });
    history.back();
    expect(store.getState().ui.goalId).toBe("goal-proj-local");
    history.forward();
    history.forward();
    history.forward();
    expect(store.getState().ui).toMatchObject({ goalId: "second", view: "canvas", selectedTaskId: "step-other", inspectorOpen: true, panelTab: "checks" });
    expect(location.pathname).toBe("/t/second/s/step-other/checks");
    expect(entries).toHaveLength(4);
    expect(history.pushState).toHaveBeenCalledTimes(3);
    expect(history.replaceState).toHaveBeenCalledTimes(1);
  });

  it("repairs a stale history entry and waits for the board on early popstate", async () => {
    const { store, receive, history, location, window } = await browser("/t/second");
    location.pathname = "/t/second/agents";
    window.dispatchEvent(new Event("popstate"));
    expect(history.replaceState).not.toHaveBeenCalled();
    receive();
    expect(store.getState().ui.view).toBe("agents");
    store.getState().openTask("step-other", "log");
    receive(reducer(board(), { type: "deleteGoal", id: "second" }), 2);
    history.back();
    expect(location.pathname).toBe("/t/goal-proj-local");
    expect(store.getState().ui).toMatchObject({ goalId: "goal-proj-local", selectedTaskId: null, inspectorOpen: false });
  });
});
