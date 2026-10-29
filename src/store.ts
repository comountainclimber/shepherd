import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { interruptChecks, loadState } from "./model/migrate";
import { reducer } from "./model/reducer";
import type { Action, Filters, OrchestrationState, UiState, ViewId } from "./model/types";
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
  view: restored.view ?? "canvas",
  projectId: restored.projectId ?? WORKSPACE_PROJECT_ID,
  selectedTaskId: restored.selectedTaskId ?? null,
  selectedAgentId: null,
  selectedEdgeId: null,
  inspectorOpen: false,
  filters: initialFilters,
  paletteOpen: false,
  newTaskOpen: false,
  newProjectOpen: false,
  decomposeOpen: false,
  decomposeSeed: "",
  contextMenu: null,
  fitToken: 0,
};

interface ShepherdStore {
  state: OrchestrationState;
  ui: UiState;
  dispatch: (action: Action) => void;
  setView: (view: ViewId) => void;
  setProject: (projectId: string) => void;
  selectTask: (id: string | null) => void;
  selectAgent: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  setInspectorOpen: (open: boolean) => void;
  setFilters: (patch: Partial<Filters>) => void;
  setPaletteOpen: (open: boolean) => void;
  setNewTaskOpen: (open: boolean) => void;
  setNewProjectOpen: (open: boolean) => void;
  setDecomposeOpen: (open: boolean) => void;
  setDecomposeSeed: (seedText: string) => void;
  setContextMenu: (menu: UiState["contextMenu"]) => void;
  requestFit: () => void;
}

let applyingRemote = false;
let localWriteAt = 0;
// zustand's persist writes on every set, even before hydration. Writing before the server
// copy has loaded would overwrite the shared board with the empty default.
let loadedFromServer = false;

if (typeof localStorage !== "undefined") {
  localStorage.removeItem("shepherd.v1");
}

const sharedStorage = {
  getItem: async () => {
    try {
      const response = await fetch("/api/state");
      if (!response.ok) return null;
      const body = (await response.json()) as { state?: { state?: unknown } };
      loadedFromServer = true;
      const saved = loadState(body.state?.state);
      if (!saved) return null;
      return JSON.stringify({ state: { state: interruptChecks(saved) }, version: 2 });
    } catch {
      return null;
    }
  },
  setItem: async (_name: string, value: string) => {
    if (applyingRemote || !loadedFromServer || !useShepherd.persist.hasHydrated()) return;
    localWriteAt = Date.now();
    await fetch("/api/state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: value,
    });
  },
  removeItem: async () => {
    await fetch("/api/state", { method: "DELETE" });
  },
};

export const useShepherd = create<ShepherdStore>()(
  persist(
    (set) => ({
      state: workspace(),
      ui: initialUi,
      dispatch: (action) => set((store) => ({ state: reducer({ ...store.state, now: Date.now() }, action) })),
      setView: (view) => set((store) => ({ ui: { ...store.ui, view, contextMenu: null } })),
      setProject: (projectId) =>
        set((store) => {
          const tasks = store.state.tasks.filter((item) => item.projectId === projectId);
          const selected = tasks.some((item) => item.id === store.ui.selectedTaskId)
            ? store.ui.selectedTaskId
            : (tasks[0]?.id ?? null);
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
            view: id ? "canvas" : store.ui.view,
          },
        })),
      selectAgent: (id) => set((store) => ({ ui: { ...store.ui, selectedAgentId: id } })),
      selectEdge: (id) => set((store) => ({ ui: { ...store.ui, selectedEdgeId: id, contextMenu: null } })),
      setInspectorOpen: (open) => set((store) => ({ ui: { ...store.ui, inspectorOpen: open } })),
      setFilters: (patch) =>
        set((store) => ({ ui: { ...store.ui, filters: { ...store.ui.filters, ...patch } } })),
      setPaletteOpen: (open) => set((store) => ({ ui: { ...store.ui, paletteOpen: open } })),
      setNewTaskOpen: (open) => set((store) => ({ ui: { ...store.ui, newTaskOpen: open, paletteOpen: false } })),
      setNewProjectOpen: (open) => set((store) => ({ ui: { ...store.ui, newProjectOpen: open, paletteOpen: false } })),
      setDecomposeOpen: (open) =>
        set((store) => ({ ui: { ...store.ui, decomposeOpen: open, paletteOpen: false } })),
      setDecomposeSeed: (seedText) => set((store) => ({ ui: { ...store.ui, decomposeSeed: seedText } })),
      setContextMenu: (menu) => set((store) => ({ ui: { ...store.ui, contextMenu: menu } })),
      requestFit: () => set((store) => ({ ui: { ...store.ui, fitToken: store.ui.fitToken + 1, view: "canvas" } })),
    }),
    {
      name: "shepherd.v2",
      version: 2,
      storage: createJSONStorage(() => sharedStorage),
      partialize: (store) => ({ state: store.state }),
      merge: (persisted, current) => {
        const saved = (persisted as { state?: OrchestrationState } | undefined)?.state;
        if (!saved) return { ...current, ui: reconcileUi(current.ui, current.state) };
        return { ...current, state: saved, ui: reconcileUi(current.ui, saved) };
      },
    },
  ),
);

function reconcileUi(ui: UiState, state: OrchestrationState): UiState {
  const projectId = state.projects.some((project) => project.id === ui.projectId)
    ? ui.projectId
    : (state.projects[0]?.id ?? WORKSPACE_PROJECT_ID);
  const task = state.tasks.find((item) => item.id === ui.selectedTaskId && item.projectId === projectId);
  return { ...ui, projectId, selectedTaskId: task?.id ?? null, inspectorOpen: !!task };
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

function fingerprint(state: OrchestrationState) {
  const projects = state.projects.map((project) => project.id).join(",");
  const tasks = state.tasks
    .map(
      (task) =>
        `${task.id}:${task.status}:${task.activity}:${task.blocker}:${task.agentId}:${task.verification.map((check) => check.state).join(",")}:${task.filesChanged.join(",")}:${task.previews.map((item) => `${item.path}:${item.text.length}`).join(",")}`,
    )
    .join("|");
  const deps = state.dependencies.map((dep) => `${dep.id}:${dep.gate}`).join(",");
  return `${projects}#${tasks}#${deps}`;
}

export async function pullSharedState() {
  if (!useShepherd.persist.hasHydrated() || Date.now() - localWriteAt < 1500) return;
  try {
    const response = await fetch("/api/state");
    if (!response.ok) return;
    const body = (await response.json()) as { state?: { state?: unknown } };
    loadedFromServer = true;
    const saved = loadState(body.state?.state);
    if (!saved) return;
    if (fingerprint(saved) === fingerprint(useShepherd.getState().state)) return;
    applyingRemote = true;
    useShepherd.setState({ state: saved });
    applyingRemote = false;
  } catch {
    applyingRemote = false;
  }
}
