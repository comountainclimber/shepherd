import { formatAgent, formatClock, formatDuration } from "../../model/format";
import { STATUS_LABEL } from "../../model/types";
import { agentById } from "../../model/workspace";
import { useShepherd } from "../../store";
import { Meta } from "../ui";
import { useSelectedTask } from "./useSelectedTask";

export function Execution() {
  const task = useSelectedTask();
  const project = useShepherd((store) => store.state.projects.find((item) => item.id === task.projectId));
  const allEvents = useShepherd((store) => store.state.events);
  const events = allEvents.filter((event) => event.taskId === task.id).slice(-8).reverse();
  const folder = [project?.directory, task.runner === "agent" ? task.worktree : ""].filter(Boolean).join("/");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Meta label="Agent" value={task.runner === "human" ? "You" : formatAgent(agentById(task.agentId))} />
        <Meta label="Status" value={STATUS_LABEL[task.status]} />
        <Meta label="Folder" value={folder ? `${folder}/` : "workspace root"} />
        <Meta label="Session" value={task.sessionId ? task.sessionId.slice(0, 12) : "—"} />
        <Meta label="Started" value={formatClock(task.startedAt)} />
        <Meta label="Last run took" value={task.elapsedMs ? formatDuration(task.elapsedMs) : "—"} />
      </div>
      <p className="text-[12px] leading-5 text-text">{task.activity || "No activity yet."}</p>
      {task.instructions.length ? (
        <section>
          <h3 className="mb-1.5 text-[11px] text-muted">Instructions</h3>
          <ul className="space-y-1">
            {task.instructions.map((line, index) => (
              <li key={`${task.id}-note-${index}`} className="border border-line bg-surface-2 px-2 py-1.5 text-[12px] leading-5">
                {line}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h3 className="mb-1.5 text-[11px] text-muted">Recent updates</h3>
        <ul className="space-y-1.5">
          {events.map((event) => (
            <li key={event.id} className="text-[12px] leading-5 text-muted">
              <span className="mr-2 font-mono text-[10px] text-faint">{formatClock(event.at)}</span>
              {event.message}
            </li>
          ))}
          {!events.length ? <li className="text-[12px] text-faint">No events yet.</li> : null}
        </ul>
      </section>
    </div>
  );
}
