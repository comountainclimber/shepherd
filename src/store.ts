import { create } from "zustand";
import { loadState } from "./model/migrate";
import { reducer } from "./model/reducer";
import type { Action, Filters, OrchestrationState, PanelTab, UiState, ViewId } from "./model/types";
import { WORKSPACE_PROJECT_ID, workspace } from "./model/workspace";

export const initialFilters: Filters = {
  status: "all",
  agentId: "all",
  verification: "all",
  savedView: "all",
  search: "",
};

const UI_KEY = "shepherd.ui";

type SavedUi = Pick<UiState, "view" | "projectId" | "selectedTaskId">;

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
  selectedTaskId: restored.selectedTaskId ?? null,
  selectedAgentId: null,
  selectedEdgeId: null,
  inspectorOpen: false,
  panelTab: "step",
  filters: initialFilters,
  paletteOpen: false,
  newProjectOpen: false,
  contextMenu: null,
  fitToken: 0,
  draftToken: 0,
  draftSeed: "",
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
  setView: (view: ViewId) => void;
  setProject: (projectId: string) => void;
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
  setView: (view) => set((store) => ({ ui: { ...store.ui, view, contextMenu: null } })),
  setProject: (projectId) =>
    set((store) => {
      const tasks = store.state.tasks.filter((item) => item.projectId === projectId);
      const selected = tasks.some((item) => item.id === store.ui.selectedTaskId) ? store.ui.selectedTaskId : (tasks[0]?.id ?? null);
      return {
        ui: {
          ...store.ui,
          projectId,
          selectedTaskId: selected,
          selectedEdgeId: null,
          contextMenu: null,
          filters: { ...store.ui.filters, agentId: "all", search: "" },
        },
      };
    }),
  selectTask: (id) =>
    set((store) => ({
      ui: {
        ...store.ui,
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
      store.ui.selectedTaskId === id ? store : { ui: { ...store.ui, selectedTaskId: id, selectedEdgeId: null, contextMenu: null } },
    ),
  openTask: (id, tab) =>
    set((store) => ({
      ui: { ...store.ui, selectedTaskId: id, selectedEdgeId: null, contextMenu: null, inspectorOpen: true, panelTab: tab, view: "canvas" },
    })),
  setPanelTab: (tab) => set((store) => ({ ui: { ...store.ui, panelTab: tab } })),
  selectAgent: (id) => set((store) => ({ ui: { ...store.ui, selectedAgentId: id } })),
  selectEdge: (id) => set((store) => ({ ui: { ...store.ui, selectedEdgeId: id, contextMenu: null } })),
  setInspectorOpen: (open) => set((store) => ({ ui: { ...store.ui, inspectorOpen: open } })),
  setFilters: (patch) => set((store) => ({ ui: { ...store.ui, filters: { ...store.ui.filters, ...patch } } })),
  setPaletteOpen: (open) => set((store) => ({ ui: { ...store.ui, paletteOpen: open } })),
  setNewProjectOpen: (open) => set((store) => ({ ui: { ...store.ui, newProjectOpen: open, paletteOpen: false } })),
  setContextMenu: (menu) => set((store) => ({ ui: { ...store.ui, contextMenu: menu } })),
  requestFit: () => set((store) => ({ ui: { ...store.ui, fitToken: store.ui.fitToken + 1, view: "canvas" } })),
  requestDraft: (seed = "") =>
    set((store) => ({ ui: { ...store.ui, draftToken: store.ui.draftToken + 1, draftSeed: seed, view: "canvas", paletteOpen: false } })),
}));

function reconcileUi(ui: UiState, state: OrchestrationState): UiState {
  const projectId = state.projects.some((project) => project.id === ui.projectId) ? ui.projectId : (state.projects[0]?.id ?? WORKSPACE_PROJECT_ID);
  const task = state.tasks.find((item) => item.id === ui.selectedTaskId && item.projectId === projectId);
  return { ...ui, projectId, selectedTaskId: task?.id ?? null, inspectorOpen: !!task };
}

function receive(revision: number, state: OrchestrationState) {
  confirmed = state;
  confirmedRevision = revision;
  pending = pending.filter((entry) => entry.revision === undefined || entry.revision > revision);
  rebase();
  if (!useShepherd.getState().loaded) {
    useShepherd.setState((store) => ({ loaded: true, ui: reconcileUi(store.ui, state) }));
  }
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
    const { view, projectId, selectedTaskId } = store.ui;
    const before = previous.ui;
    if (view === before.view && projectId === before.projectId && selectedTaskId === before.selectedTaskId) return;
    localStorage.setItem(UI_KEY, JSON.stringify({ view, projectId, selectedTaskId } satisfies SavedUi));
  });
}

export function clearWorkspace() {
  if (!window.confirm("Remove every project and task from Shepherd? Files on disk stay where they are.")) return;
  useShepherd.getState().dispatch({ type: "reset" });
}
