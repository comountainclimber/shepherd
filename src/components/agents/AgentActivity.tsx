import { cx, formatClock, statusLabel } from "../../model/format";
import type { Task } from "../../model/types";
import { isFullyVerified } from "../../model/verify";
import { AGENTS } from "../../model/workspace";
import { useShepherd } from "../../store";
import { statusText } from "../ui";

const order: Record<Task["status"], number> = { running: 0, failed: 1, completed: 2, blocked: 3, queued: 4 };

export function AgentActivity() {
  const tasks = useShepherd((store) => store.state.tasks);
  const events = useShepherd((store) => store.state.events);
  const projects = useShepherd((store) => store.state.projects);
  const projectId = useShepherd((store) => store.ui.projectId);
  const selectedId = useShepherd((store) => store.ui.selectedAgentId);
  const selectAgent = useShepherd((store) => store.selectAgent);
  const selectTask = useShepherd((store) => store.selectTask);

  const assignedTo = (agentId: string) =>
    tasks.filter((task) => task.runner === "agent" && task.agentId === agentId && task.projectId === projectId);
  const selected =
    AGENTS.find((agent) => agent.id === selectedId) ?? AGENTS.find((agent) => assignedTo(agent.id).length) ?? AGENTS[0]!;
  const assigned = assignedTo(selected.id).sort((a, b) => order[a.status] - order[b.status]);
  const lastEvent = (task: Task) => events.filter((event) => event.taskId === task.id).at(-1);
  const project = projects.find((item) => item.id === projectId);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="border-b border-line px-4 py-2 text-[12px] text-muted">
        Each run starts its own Claude Code or Codex process, so one agent can work on several tasks at once.
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[360px] shrink-0 overflow-auto border-r border-line">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-bg text-[10px] uppercase tracking-[0.08em] text-faint">
              <tr>
                <th className="px-3 py-2 font-normal">Agent</th>
                <th className="px-2 py-2 font-normal">Running</th>
                <th className="px-2 py-2 font-normal">Tasks here</th>
              </tr>
            </thead>
            <tbody>
              {AGENTS.map((agent) => {
                const mine = tasks.filter((task) => task.runner === "agent" && task.agentId === agent.id);
                const running = mine.filter((task) => task.status === "running").length;
                return (
                  <tr
                    key={agent.id}
                    className={cx("cursor-pointer border-t border-line", agent.id === selected.id ? "bg-surface-2" : "hover:bg-surface")}
                    onClick={() => selectAgent(agent.id)}
                  >
                    <td className="px-3 py-2">
                      <div className="text-[12px] text-text">{agent.name}</div>
                      <div className="font-mono text-[10px] text-faint">{agent.model}</div>
                    </td>
                    <td className={cx("px-2 py-2 font-mono text-[12px]", running ? "text-running" : "text-muted")}>{running}</td>
                    <td className="px-2 py-2 font-mono text-[12px] text-muted">{assignedTo(agent.id).length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="min-w-0 flex-1 overflow-auto px-5 py-4">
          <h2 className="text-[16px] font-medium">{selected.name}</h2>
          <div className="mt-0.5 font-mono text-[11px] text-faint">{selected.model}</div>
          <h3 className="mb-1 mt-4 text-[11px] uppercase tracking-[0.08em] text-faint">Its tasks in {project?.name ?? "this project"}</h3>
          {assigned.length ? (
            <ul className="max-w-2xl divide-y divide-line border border-line">
              {assigned.map((task) => {
                const event = lastEvent(task);
                return (
                  <li key={task.id}>
                    <button type="button" className="block w-full px-3 py-2 text-left hover:bg-surface" onClick={() => selectTask(task.id)}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[13px] text-text">{task.name}</span>
                        <span className={cx("shrink-0 text-[11px]", statusText[task.status])}>
                          {isFullyVerified(task) ? "Verified" : statusLabel(task.status)}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[12px] text-muted">{task.blocker ?? task.activity}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-faint">
                        {task.worktree}/{event ? ` · ${formatClock(event.at)} ${event.message}` : ""}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[12px] text-faint">No tasks in this project are assigned to {selected.name}.</p>
          )}
        </div>
      </div>
    </div>
  );
}
