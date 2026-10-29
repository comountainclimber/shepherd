import { Search } from "lucide-react";
import { needsMe, tasksForProject } from "../../model/selectors";
import { STATUSES, STATUS_LABEL } from "../../model/types";
import { AGENTS } from "../../model/workspace";
import { useShepherd } from "../../store";
import { Button } from "../ui";

export function TopBar() {
  const ui = useShepherd((store) => store.ui);
  const state = useShepherd((store) => store.state);
  const setProject = useShepherd((store) => store.setProject);
  const setFilters = useShepherd((store) => store.setFilters);
  const setNewTaskOpen = useShepherd((store) => store.setNewTaskOpen);
  const setDecomposeOpen = useShepherd((store) => store.setDecomposeOpen);
  const setInspectorOpen = useShepherd((store) => store.setInspectorOpen);
  const tasks = tasksForProject(state, ui.projectId);
  const running = tasks.filter((task) => task.status === "running").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const yours = tasks.filter((task) => needsMe(task, state.tasks, state.dependencies)).length;
  const projectAgents = AGENTS.filter((agent) => tasks.some((task) => task.agentId === agent.id));

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
      <select
        aria-label="Project"
        value={ui.projectId}
        onChange={(event) => setProject(event.target.value)}
        className="h-7 max-w-[220px] rounded-md border border-line bg-surface px-2 text-[12px] outline-none"
      >
        {state.projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <div className="hidden items-center gap-2 font-mono text-[11px] text-muted lg:flex">
        <span className={running ? "text-running" : ""}>{running} active</span>
        <span className="text-faint">·</span>
        <span className={failed ? "text-failed" : ""}>{failed} failed</span>
        <span className="text-faint">·</span>
        <button
          type="button"
          className={yours ? "text-approval hover:underline" : ""}
          onClick={() => setFilters({ savedView: "needs-me" })}
        >
          {yours} need you
        </button>
      </div>
      <div className="relative ml-auto min-w-0 max-w-[240px] flex-1">
        <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
        <input
          value={ui.filters.search}
          onChange={(event) => setFilters({ search: event.target.value })}
          placeholder="Search tasks"
          className="h-7 w-full rounded-md border border-line bg-surface-2 pl-7 pr-2 text-[12px] outline-none placeholder:text-faint focus:border-brass"
        />
      </div>
      <select
        aria-label="Status"
        value={ui.filters.status}
        onChange={(event) => setFilters({ status: event.target.value as typeof ui.filters.status })}
        className="h-7 rounded-md border border-line bg-surface px-2 text-[12px] outline-none"
      >
        <option value="all">Any status</option>
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABEL[status]}
          </option>
        ))}
      </select>
      <select
        aria-label="Agent"
        value={ui.filters.agentId}
        onChange={(event) => setFilters({ agentId: event.target.value })}
        className="hidden h-7 max-w-[140px] rounded-md border border-line bg-surface px-2 text-[12px] outline-none xl:block"
      >
        <option value="all">Any agent</option>
        {projectAgents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Verification"
        value={ui.filters.verification}
        onChange={(event) => setFilters({ verification: event.target.value as typeof ui.filters.verification })}
        className="hidden h-7 rounded-md border border-line bg-surface px-2 text-[12px] outline-none lg:block"
      >
        <option value="all">Any verification</option>
        <option value="verified">Verified</option>
        <option value="unverified">Unverified completion</option>
        <option value="failed">Failed checks</option>
      </select>
      {ui.selectedTaskId && !ui.inspectorOpen && ui.view === "canvas" ? (
        <Button variant="quiet" onClick={() => setInspectorOpen(true)}>
          Inspector
        </Button>
      ) : null}
      <Button variant="ghost" onClick={() => setDecomposeOpen(true)}>
        Decompose
      </Button>
      <Button variant="primary" onClick={() => setNewTaskOpen(true)}>
        New task
      </Button>
    </header>
  );
}
