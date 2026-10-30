import { formatAgent, formatClock, formatDuration } from "../../model/format";
import { STATUS_LABEL } from "../../model/types";
import { agentById } from "../../model/workspace";
import { workspacePath } from "../../runner/live";
import { useShepherd } from "../../store";
import { Meta } from "../ui";
import { useSelectedTask } from "./useSelectedTask";

export function Execution() {
  const task = useSelectedTask();
  const project = useShepherd((store) => store.state.projects.find((item) => item.id === task.projectId));
  const allEvents = useShepherd((store) => store.state.events);
  const events = allEvents.filter((event) => event.taskId === task.id).slice(-8).reverse();
  const human = task.runner === "human";
  const git = task.git;
  const folder = human || !git ? [workspacePath() || ".agent-sandbox", project?.directory].filter(Boolean).join("/") : git.folder;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Meta label="Agent" value={human ? "You" : formatAgent(agentById(task.agentId))} />
        <Meta label="Status" value={STATUS_LABEL[task.status]} />
        {human ? null : (
          <>
            <Meta label="Branch" value={git ? git.branch : "Created on the first run"} />
            <Meta label="Commit" value={git?.head ?? "—"} />
          </>
        )}
        <Meta label="Session" value={task.sessionId ? task.sessionId.slice(0, 12) : "—"} />
        <Meta label="Started" value={formatClock(task.startedAt)} />
        <Meta label="Last run took" value={task.elapsedMs ? formatDuration(task.elapsedMs) : "—"} />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-[0.08em] text-faint">{human || !git ? "Project folder" : "Worktree"}</div>
        <div className="break-all font-mono text-[11px] leading-5 text-text">{folder}/</div>
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
