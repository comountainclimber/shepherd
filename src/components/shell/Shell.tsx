import { useEffect } from "react";
import { pullSharedState, useShepherd } from "../../store";
import { AgentActivity } from "../agents/AgentActivity";
import { OrchestrationCanvas } from "../canvas/OrchestrationCanvas";
import { CommandPalette } from "../delegation/CommandPalette";
import { DecomposeDialog } from "../delegation/DecomposeDialog";
import { NewProjectDialog } from "../delegation/NewProjectDialog";
import { NewTaskDialog } from "../delegation/NewTaskDialog";
import { TaskInspector } from "../inspector/TaskInspector";
import { ActivityStrip } from "./ActivityStrip";
import { ProjectView } from "./ProjectView";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function Shell() {
  const view = useShepherd((store) => store.ui.view);
  const inspectorOpen = useShepherd((store) => store.ui.inspectorOpen);
  const selectedTaskId = useShepherd((store) => store.ui.selectedTaskId);
  const tasks = useShepherd((store) => store.state.tasks);
  const selectTask = useShepherd((store) => store.selectTask);

  useEffect(() => {
    if (selectedTaskId && !tasks.some((task) => task.id === selectedTaskId)) selectTask(null);
  }, [selectedTaskId, tasks, selectTask]);

  useEffect(() => {
    void pullSharedState();
    const id = window.setInterval(() => void pullSharedState(), 2000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const store = useShepherd.getState();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        store.setPaletteOpen(!store.ui.paletteOpen);
        return;
      }
      if (event.key === "Escape") {
        if (store.ui.paletteOpen) store.setPaletteOpen(false);
        else if (store.ui.newProjectOpen) store.setNewProjectOpen(false);
        else if (store.ui.newTaskOpen) store.setNewTaskOpen(false);
        else if (store.ui.decomposeOpen) store.setDecomposeOpen(false);
        else if (store.ui.contextMenu) store.setContextMenu(null);
        else if (store.ui.inspectorOpen) store.setInspectorOpen(false);
        return;
      }
      if (typing) return;
      if (event.key === "n") {
        event.preventDefault();
        store.setNewTaskOpen(true);
      } else if (event.key === "1") store.setView("canvas");
      else if (event.key === "2") store.setView("agents");
      else if (event.key === "3") store.setView("project");
      else if (event.key === "f") store.requestFit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showInspector = view === "canvas" && inspectorOpen && !!selectedTaskId && tasks.some((task) => task.id === selectedTaskId);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-text">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <div className="flex min-h-0 flex-1">
            <main className="relative min-h-0 min-w-0 flex-1">
              {view === "canvas" ? <OrchestrationCanvas /> : null}
              {view === "agents" ? <AgentActivity /> : null}
              {view === "project" ? <ProjectView /> : null}
            </main>
            {showInspector ? <TaskInspector /> : null}
          </div>
          <ActivityStrip />
        </div>
      </div>
      <CommandPalette />
      <NewProjectDialog />
      <NewTaskDialog />
      <DecomposeDialog />
    </div>
  );
}
