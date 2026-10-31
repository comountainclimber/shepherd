import { useEffect } from "react";
import { connectToServer, useShepherd } from "../../store";
import { AgentActivity } from "../agents/AgentActivity";
import { OrchestrationCanvas } from "../canvas/OrchestrationCanvas";
import { CommandPalette } from "../delegation/CommandPalette";
import { NewProjectDialog } from "../delegation/NewProjectDialog";
import { TaskInspector } from "../inspector/TaskInspector";
import { Outline } from "../outline/Outline";
import { Hud, Sheep } from "./Hud";
import { ServerNotice } from "./ServerNotice";
import { Toasts, useTaskToasts } from "./Toasts";

export function Shell() {
  const view = useShepherd((store) => store.ui.view);
  const inspectorOpen = useShepherd((store) => store.ui.inspectorOpen);
  const selectedTaskId = useShepherd((store) => store.ui.selectedTaskId);
  const tasks = useShepherd((store) => store.state.tasks);
  const loaded = useShepherd((store) => store.loaded);
  const selectTask = useShepherd((store) => store.selectTask);

  useEffect(() => {
    if (loaded && selectedTaskId && !tasks.some((task) => task.id === selectedTaskId)) selectTask(null);
  }, [loaded, selectedTaskId, tasks, selectTask]);

  useEffect(() => connectToServer(), []);
  useTaskToasts();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      const store = useShepherd.getState();
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        store.setPaletteOpen(!store.ui.paletteOpen);
        return;
      }
      if (event.key === "Escape") {
        if (store.ui.paletteOpen) store.setPaletteOpen(false);
        else if (store.ui.newProjectOpen) store.setNewProjectOpen(false);
        else if (store.ui.contextMenu) store.setContextMenu(null);
        else if (store.ui.inspectorOpen && !typing) store.setInspectorOpen(false);
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "1") store.setView("canvas");
      else if (event.key === "2") store.setView("agents");
      else if (event.key === "f") store.requestFit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showInspector = inspectorOpen && !!selectedTaskId && tasks.some((task) => task.id === selectedTaskId);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg text-text">
      <Hud />
      <ServerNotice />
      <div className="flex min-h-0 flex-1">
        {loaded ? <Outline /> : null}
        <div className="relative min-w-0 flex-1">
          <main className="h-full">{!loaded ? <Loading /> : view === "canvas" ? <OrchestrationCanvas /> : <AgentActivity />}</main>
          {loaded && showInspector ? <TaskInspector /> : null}
        </div>
      </div>
      <Toasts />
      <CommandPalette />
      <NewProjectDialog />
    </div>
  );
}

function Loading() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
      <Sheep size={40} />
      <p className="text-[13px]">Connecting to Shepherd…</p>
    </div>
  );
}
