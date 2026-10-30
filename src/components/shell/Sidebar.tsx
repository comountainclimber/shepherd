import { useEffect, useState } from "react";
import { cx } from "../../model/format";
import { needsMe, tasksForProject } from "../../model/selectors";
import { SAVED_VIEWS, type Task } from "../../model/types";
import { agentStatus, setWorkspacePath, workspacePath } from "../../runner/live";
import { clearWorkspace, useShepherd } from "../../store";

export function Sidebar() {
  const ui = useShepherd((store) => store.ui);
  const state = useShepherd((store) => store.state);
  const setView = useShepherd((store) => store.setView);
  const setProject = useShepherd((store) => store.setProject);
  const setNewProjectOpen = useShepherd((store) => store.setNewProjectOpen);
  const setFilters = useShepherd((store) => store.setFilters);
  const selectTask = useShepherd((store) => store.selectTask);
  const yours = tasksForProject(state, ui.projectId).filter((task) => needsMe(task, state.tasks, state.dependencies));
  const [workspace, setWorkspace] = useState(workspacePath);
  const [agentsOnline, setAgentsOnline] = useState<{ claude: boolean; codex: boolean; git: boolean } | null>(null);

  useEffect(() => {
    agentStatus()
      .then((status) => {
        setAgentsOnline({ claude: status.claude, codex: status.codex, git: status.git });
        if (!workspacePath() && status.workspace) {
          setWorkspacePath(status.workspace);
          setWorkspace(status.workspace);
        }
      })
      .catch(() => setAgentsOnline({ claude: false, codex: false, git: false }));
  }, []);

  return (
    <aside className="flex h-full w-[228px] shrink-0 flex-col border-r border-line bg-bg">
      <div className="flex h-11 items-center gap-2 border-b border-line px-3">
        <span className="h-2 w-2 rounded-sm bg-brass" />
        <span className="text-[13px] font-medium tracking-[0.04em]">Shepherd</span>
      </div>
      <nav className="flex gap-1 px-2 py-2">
        {(
          [
            ["canvas", "Canvas"],
            ["agents", "Agents"],
            ["project", "Project"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            className={cx(
              "h-7 flex-1 rounded-md text-[12px]",
              ui.view === id ? "bg-surface-2 text-text" : "text-muted hover:text-text",
            )}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        <Section label="Projects" />
        {state.projects.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setProject(item.id)}
            className={cx(
              "block w-full truncate rounded-md px-2 py-1.5 text-left text-[12px]",
              item.id === ui.projectId ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            {item.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setNewProjectOpen(true)}
          className="mt-1 block w-full rounded-md px-2 py-1.5 text-left text-[12px] text-muted hover:bg-surface-2 hover:text-text"
        >
          New project
        </button>
        <Section label="Views" />
        {SAVED_VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => {
              setView("canvas");
              setFilters({ savedView: view.id, status: "all", verification: "all" });
            }}
            className={cx(
              "block w-full rounded-md px-2 py-1.5 text-left text-[12px]",
              ui.filters.savedView === view.id ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2 hover:text-text",
            )}
          >
            {view.label}
          </button>
        ))}
        <Section label="Needs you" />
        {yours.map((task) => (
          <button
            key={task.id}
            type="button"
            onClick={() => selectTask(task.id)}
            className={cx(
              "block w-full rounded-md px-2 py-1.5 text-left",
              ui.selectedTaskId === task.id ? "bg-surface-2" : "hover:bg-surface-2",
            )}
          >
            <div className="truncate text-[12px] text-text">{task.name}</div>
            <div className="text-[10px] text-approval">{needsReason(task)}</div>
          </button>
        ))}
        {!yours.length ? <p className="px-2 py-1 text-[11px] text-faint">Nothing is waiting on you.</p> : null}
      </div>
      <div className="border-t border-line px-3 py-2">
        <label className="block text-[10px] uppercase tracking-[0.08em] text-faint">
          Workspace
          <input
            value={workspace}
            onChange={(event) => {
              setWorkspace(event.target.value);
              setWorkspacePath(event.target.value);
            }}
            className="mt-1 h-7 w-full rounded-md border border-line bg-surface px-2 font-mono text-[10px] text-text outline-none focus:border-brass"
          />
        </label>
        <p className="mt-2 text-[11px] leading-4 text-muted">
          {agentsOnline === null
            ? "Checking Claude and Codex…"
            : `Claude ${agentsOnline.claude ? "ready" : "signed out"} · Codex ${agentsOnline.codex ? "ready" : "signed out"}`}
        </p>
        {agentsOnline && !agentsOnline.git ? (
          <p className="mt-1 text-[11px] leading-4 text-failed">git is not installed, so agent tasks cannot run.</p>
        ) : null}
        <button type="button" className="mt-2 text-[12px] text-muted hover:text-text" onClick={clearWorkspace}>
          Clear workspace
        </button>
      </div>
    </aside>
  );
}

function needsReason(task: Task): string {
  const checkFailed = task.blocker?.startsWith("The check failed");
  if (task.status === "completed") return "Review what it wrote";
  if (task.status === "failed") {
    if (checkFailed) return "Check failed. Retry it";
    return task.activity === "Rejected by you" ? "Rejected. Retry it" : "Failed. Retry it";
  }
  if (checkFailed) return "Check failed. Fix it";
  if (task.status === "blocked") return "Paused";
  return "Your turn";
}

function Section({ label }: { label: string }) {
  return <div className="px-2 pb-1 pt-3 text-[10px] uppercase tracking-[0.12em] text-faint">{label}</div>;
}
