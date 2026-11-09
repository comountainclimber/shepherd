import { create } from "zustand";
import { graphsOf } from "./model/graphs";
import { loadState } from "./model/migrate";
import { reducer } from "./model/reducer";
import { pathFor, placeFromPath, type Place } from "./model/route";
import type { Action, Filters, OrchestrationState, PanelTab, SavedPlace, UiState, ViewId } from "./model/types";
import { WORKSPACE_PROJECT_ID, workspace } from "./model/workspace";

export const initialFilters: Filters = {
  status: "all",
  agentId: "all",
  verification: "all",
  savedView: "all",
  search: "",
};

const UI_KEY = "shepherd.ui";

type SavedUi = Pick<UiState, "view" | "projectId" | "objectiveId" | "goalId" | "selectedTaskId">;

function savedUi(): Partial<SavedUi> {
  try {
    return typeof localStorage === "undefined" ? {} : (JSON.parse(localStorage.getItem(UI_KEY) ?? "{}") as Partial<SavedUi>);
  } catch {
    return {};
  }
}

const restored = savedUi();

export const initialUi: UiState = {
  view: restored.view === "agents" ? "agents" : "canvas",
  projectId: restored.projectId ?? WORKSPACE_PROJECT_ID,
  objectiveId: restored.objectiveId ?? "",
  goalId: restored.goalId ?? `goal-${WORKSPACE_PROJECT_ID}`,
  selectedTaskId: restored.selectedTaskId ?? null,
  selectedAgentId: null,
  selectedEdgeId: null,
  inspectorOpen: false,
  panelTab: "step",
  filters: initialFilters,
  paletteOpen: false,
  newProjectOpen: false,
  newTaskProjectId: null,
  contextMenu: null,
  fitToken: 0,
  draftToken: 0,
  draftSeed: "",
  saveFor: null,
  addSaved: null,
  manageSaved: false,
};

export type Connection = "connecting" | "open" | "lost";

interface ShepherdStore {
  state: OrchestrationState;
  ui: UiState;
  /** The board has arrived from the server at least once. */
  loaded: boolean;
  connection: Connection;
  /** The last change or command the server refused. */
  problem: string | null;
  dispatch: (action: Action) => void;
  setProblem: (problem: string | null) => void;
  setSaveFor: (taskId: string | null) => void;
  setAddSaved: (place: SavedPlace | null) => void;
  setManageSaved: (open: boolean) => void;
  setView: (view: ViewId) => void;
  setProject: (projectId: string) => void;
  setGoal: (goalId: string) => void;
  /** Picks an objective and focuses its first graph, if it has one. */
  setObjective: (objectiveId: string) => void;
  /** Picks nothing in the sidebar: no objective, graph or step. */
  clearSelection: () => void;
  selectTask: (id: string | null) => void;
  /** Selects a step without opening its panel; an open panel follows it. */
  focusTask: (id: string) => void;
  /** Selects a task and opens its panel on a tab. */
  openTask: (id: string, tab: PanelTab) => void;
  setPanelTab: (tab: PanelTab) => void;
  selectAgent: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  setInspectorOpen: (open: boolean) => void;
  setFilters: (patch: Partial<Filters>) => void;
  setPaletteOpen: (open: boolean) => void;
  setNewProjectOpen: (open: boolean) => void;
  setNewTaskProject: (projectId: string | null) => void;
  setContextMenu: (menu: UiState["contextMenu"]) => void;
  requestFit: () => void;
  /** Puts the cursor in the outline's goal box, with a goal in it if given. */
  requestDraft: (seed?: string) => void;
}

if (typeof localStorage !== "undefined") {
  localStorage.removeItem("shepherd.v1");
  localStorage.removeItem("shepherd.v2");
  localStorage.removeItem("shepherd.workspace");
  localStorage.removeItem("shepherd.sound");
}

/**
 * The server owns the board. A tab shows the server's latest board with its own unconfirmed edits
 * applied on top, so typing and dragging feel instant; each edit drops out once the server's board
 * includes it.
 */
interface Pending {
  action: Action;
  /** The server revision that includes this edit, once the server has answered. */
  revision?: number;
}

let confirmed: OrchestrationState = workspace();
let confirmedRevision = 0;
let pending: Pending[] = [];

function rebase() {
  const state = pending.reduce((board, entry) => reducer({ ...board, now: Date.now() }, entry.action), confirmed);
  useShepherd.setState({ state });
}

async function send(entry: Pending) {
  try {
    const response = await fetch("/api/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: entry.action }),
    });
    const body = (await response.json()) as { revision?: number; error?: string };
    if (!response.ok) throw new Error(body.error ?? `The server refused the change (${response.status}).`);
    entry.revision = body.revision ?? 0;
    if (entry.revision > confirmedRevision) return;
  } catch (error) {
    useShepherd.setState({ problem: error instanceof Error ? error.message : "Could not reach the Shepherd server." });
  }
  pending = pending.filter((item) => item !== entry);
  rebase();
}

export const useShepherd = create<ShepherdStore>()((set) => ({
  state: confirmed,
  ui: initialUi,
  loaded: false,
  connection: "connecting",
  problem: null,
  dispatch: (action) => {
    const entry: Pending = { action };
    pending.push(entry);
    set((store) => ({ state: reducer({ ...store.state, now: Date.now() }, action) }));
    void send(entry);
  },
  setProblem: (problem) => set({ problem }),
  setSaveFor: (saveFor) => set((store) => ({ ui: { ...store.ui, saveFor, contextMenu: null, paletteOpen: false } })),
  setAddSaved: (addSaved) => set((store) => ({ ui: { ...store.ui, addSaved, contextMenu: null, paletteOpen: false, view: addSaved ? "canvas" : store.ui.view } })),
  setManageSaved: (manageSaved) => set((store) => ({ ui: { ...store.ui, manageSaved, addSaved: null, paletteOpen: false } })),
  setView: (view) => set((store) => ({ ui: { ...store.ui, view, contextMenu: null } })),
  setProject: (projectId) =>
    set((store) => {
      const goalId = store.state.goals.find((goal) => goal.projectId === projectId && goal.status === "open")?.id ?? store.state.goals.find((goal) => goal.projectId === projectId)?.id ?? "";
      const tasks = store.state.tasks.filter((item) => item.goalId === goalId);
      const selected = tasks.some((item) => item.id === store.ui.selectedTaskId) ? store.ui.selectedTaskId : (tasks[0]?.id ?? null);
      return {
        ui: {
          ...store.ui,
          projectId,
          objectiveId: store.state.goals.find((goal) => goal.id === goalId)?.objectiveId ?? "",
          goalId,
          selectedTaskId: selected,
          selectedEdgeId: null,
          contextMenu: null,
          addSaved: null,
          filters: initialFilters,
          selectedAgentId: null,
          inspectorOpen: false,
          draftSeed: "",
          draftToken: 0,
          fitToken: store.ui.fitToken + 1,
        },
      };
    }),
  setGoal: (goalId) => set((store) => {
    const goal = store.state.goals.find((goal) => goal.id === goalId);
    if (!goal) return store;
    return { ui: { ...store.ui, projectId: goal.projectId, objectiveId: goal.objectiveId ?? "", goalId, selectedTaskId: null,
      selectedEdgeId: null, selectedAgentId: null, contextMenu: null, addSaved: null, saveFor: null, filters: initialFilters, inspectorOpen: false, draftSeed: "", draftToken: 0, fitToken: store.ui.fitToken + 1 } };
  }),
  setObjective: (objectiveId) => set((store) => {
    const objective = store.state.objectives.find((item) => item.id === objectiveId);
    if (!objective) return store;
    const goalId = graphsOf(store.state, objectiveId)[0]?.id ?? "";
    return { ui: { ...store.ui, ...cleared(store.ui), projectId: objective.projectId, objectiveId, goalId } };
  }),
  clearSelection: () => set((store) => ({ ui: { ...store.ui, ...cleared(store.ui), objectiveId: "", goalId: "" } })),
  selectTask: (id) =>
    set((store) => ({
      ui: {
        ...store.ui,
        ...selection(store.state, id),
        selectedTaskId: id,
        selectedEdgeId: null,
        contextMenu: null,
        inspectorOpen: id ? true : store.ui.inspectorOpen,
        panelTab: id === store.ui.selectedTaskId ? store.ui.panelTab : "step",
        view: id ? "canvas" : store.ui.view,
      },
    })),
  focusTask: (id) =>
    set((store) =>
      store.ui.selectedTaskId === id ? store : { ui: { ...store.ui, ...selection(store.state, id), selectedTaskId: id, selectedEdgeId: null, contextMenu: null } },
    ),
  openTask: (id, tab) =>
    set((store) => ({
      ui: { ...store.ui, ...selection(store.state, id), selectedTaskId: id, selectedEdgeId: null, contextMenu: null, inspectorOpen: true, panelTab: tab, view: "canvas" },
    })),
  setPanelTab: (tab) => set((store) => ({ ui: { ...store.ui, panelTab: tab } })),
  selectAgent: (id) => set((store) => ({ ui: { ...store.ui, selectedAgentId: id } })),
  selectEdge: (id) => set((store) => ({ ui: { ...store.ui, selectedEdgeId: id, contextMenu: null } })),
  setInspectorOpen: (open) => set((store) => ({ ui: { ...store.ui, inspectorOpen: open } })),
  setFilters: (patch) => set((store) => ({ ui: { ...store.ui, filters: { ...store.ui.filters, ...patch } } })),
  setPaletteOpen: (open) => set((store) => ({ ui: { ...store.ui, paletteOpen: open } })),
  setNewTaskProject: (newTaskProjectId) => set((store) => ({ ui: { ...store.ui, newTaskProjectId, paletteOpen: false, contextMenu: null } })),
  setNewProjectOpen: (open) => set((store) => ({ ui: { ...store.ui, newProjectOpen: open, paletteOpen: false } })),
  setContextMenu: (menu) => set((store) => ({ ui: { ...store.ui, contextMenu: menu } })),
  requestFit: () => set((store) => ({ ui: { ...store.ui, fitToken: store.ui.fitToken + 1, view: "canvas" } })),
  requestDraft: (seed = "") =>
    set((store) => ({ ui: { ...store.ui, draftToken: store.ui.draftToken + 1, draftSeed: seed, view: "canvas", paletteOpen: false } })),
}));

/**
 * Keeps the picked repo, objective, graph and step pointing at things on the board. An empty graph
 * is a choice (an objective with no graph yet, or nothing picked) and stays empty.
 */
export function reconcileUi(ui: UiState, state: OrchestrationState): UiState {
  const projectId = state.projects.some((project) => project.id === ui.projectId) ? ui.projectId : (state.projects[0]?.id ?? WORKSPACE_PROJECT_ID);
  const kept = state.goals.find((goal) => goal.id === ui.goalId && goal.projectId === projectId);
  const objective = state.objectives.find((item) => item.id === (kept ? kept.objectiveId : ui.objectiveId) && item.projectId === projectId && !item.archived);
  const goalId = kept?.id
    ?? (!ui.goalId ? "" : undefined)
    ?? (objective ? graphsOf(state, objective.id)[0]?.id : undefined)
    ?? state.goals.find((goal) => goal.projectId === projectId && goal.status === "open")?.id
    ?? state.goals.find((goal) => goal.projectId === projectId)?.id ?? "";
  const objectiveId = state.goals.find((goal) => goal.id === goalId)?.objectiveId ?? objective?.id ?? "";
  const task = state.tasks.find((item) => item.id === ui.selectedTaskId && item.goalId === goalId);
  return { ...ui, projectId, objectiveId, goalId, selectedTaskId: task?.id ?? null, inspectorOpen: !!task && ui.inspectorOpen };
}

function receive(revision: number, state: OrchestrationState) {
  confirmed = state;
  confirmedRevision = revision;
  pending = pending.filter((entry) => entry.revision === undefined || entry.revision > revision);
  rebase();
  useShepherd.setState((store) => ({ loaded: true, ui: reconcileUi(store.ui, store.state) }));
}

/** Follows the server's board for as long as the tab is open. EventSource reconnects by itself. */
export function connectToServer(): () => void {
  const source = new EventSource("/api/stream");
  source.onopen = () => {
    // A restarted server counts revisions from 1 again; edits it already answered are in its saved board.
    pending = pending.filter((entry) => entry.revision === undefined);
    useShepherd.setState({ connection: "open" });
  };
  source.onerror = () => useShepherd.setState({ connection: "lost" });
  source.onmessage = (event: MessageEvent<string>) => {
    try {
      const body = JSON.parse(event.data) as { revision?: number; state?: unknown };
      const state = loadState(body.state);
      if (state && typeof body.revision === "number") receive(body.revision, state);
    } catch {
      // A malformed message is skipped; the next one carries the whole board again.
    }
  };
  return () => source.close();
}

if (typeof localStorage !== "undefined") {
  useShepherd.subscribe((store, previous) => {
    const { view, projectId, objectiveId, goalId, selectedTaskId } = store.ui;
    const before = previous.ui;
    if (view === before.view && projectId === before.projectId && objectiveId === before.objectiveId && goalId === before.goalId && selectedTaskId === before.selectedTaskId) return;
    localStorage.setItem(UI_KEY, JSON.stringify({ view, projectId, objectiveId, goalId, selectedTaskId } satisfies SavedUi));
  });
}

function placeForUi(ui: UiState): Place {
  return { goalId: ui.goalId, view: ui.view, stepId: ui.inspectorOpen && ui.view === "canvas" ? ui.selectedTaskId : null, tab: ui.panelTab };
}

if (typeof window !== "undefined") {
  let applyingPath = false;

  const writePath = (replace: boolean) => {
    const path = pathFor(placeForUi(useShepherd.getState().ui));
    if (path === location.pathname) return;
    if (replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
  };

  const applyPath = () => {
    const store = useShepherd.getState();
    if (!store.loaded) return;
    const place = placeFromPath(location.pathname);
    applyingPath = true;
    try {
      if (place && store.state.goals.some((goal) => goal.id === place.goalId)) {
        store.setGoal(place.goalId);
        store.setView(place.view);
        if (place.stepId && store.state.tasks.some((task) => task.id === place.stepId && task.goalId === place.goalId)) {
          store.openTask(place.stepId, place.tab);
        }
      }
    } finally {
      applyingPath = false;
    }
    writePath(true);
  };

  useShepherd.subscribe((store, previous) => {
    if (!store.loaded || applyingPath) return;
    if (!previous.loaded) {
      applyPath();
      return;
    }
    const place = placeForUi(store.ui);
    const before = placeForUi(previous.ui);
    if (pathFor(place) === pathFor(before)) return;
    const replace = place.goalId === before.goalId && place.view === before.view && (place.stepId === null || place.stepId === before.stepId);
    writePath(replace);
  });
  window.addEventListener("popstate", applyPath);
}

export function clearWorkspace() {
  if (!window.confirm("Remove every project and task from Shepherd? Files on disk stay where they are.")) return;
  useShepherd.getState().dispatch({ type: "reset" });
}

function selection(state: OrchestrationState, id: string | null): Partial<UiState> {
  const task = state.tasks.find((task) => task.id === id);
  const objectiveId = state.goals.find((goal) => goal.id === task?.goalId)?.objectiveId ?? "";
  return task ? { projectId: task.projectId, objectiveId, goalId: task.goalId } : {};
}

/** What picking another objective or graph lets go of. */
function cleared(ui: UiState): Partial<UiState> {
  return { selectedTaskId: null, selectedEdgeId: null, selectedAgentId: null, contextMenu: null, addSaved: null, saveFor: null, filters: initialFilters, inspectorOpen: false, draftSeed: "", draftToken: 0, fitToken: ui.fitToken + 1 };
}
