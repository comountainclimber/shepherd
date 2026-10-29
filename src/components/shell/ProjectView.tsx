import { formatClock } from "../../model/format";
import { needsMe, tasksForProject } from "../../model/selectors";
import { STATUS_LABEL, STATUSES } from "../../model/types";
import { isFullyVerified } from "../../model/verify";
import { workspacePath } from "../../runner/live";
import { useShepherd } from "../../store";
import { statusText } from "../ui";

const toneText = {
  info: "text-muted",
  success: "text-completed",
  warning: "text-blocked",
  failure: "text-failed",
};

export function ProjectView() {
  const ui = useShepherd((store) => store.ui);
  const state = useShepherd((store) => store.state);
  const selectTask = useShepherd((store) => store.selectTask);
  const project = state.projects.find((item) => item.id === ui.projectId);
  const tasks = tasksForProject(state, ui.projectId);
  const events = state.events.filter((event) => event.projectId === ui.projectId).slice(-24).reverse();

  if (!project) return null;

  const verified = tasks.filter(isFullyVerified).length;
  const yours = tasks.filter((task) => needsMe(task, state.tasks, state.dependencies)).length;
  const folder = [workspacePath() || ".agent-sandbox", project.directory].filter(Boolean).join("/");

  return (
    <div className="h-full overflow-auto bg-bg px-8 py-6">
      <div className="max-w-3xl">
        <div className="text-[11px] uppercase tracking-[0.12em] text-faint">Project</div>
        <h1 className="mt-1 text-[18px] font-medium text-text">{project.name}</h1>
        {project.summary ? <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted">{project.summary}</p> : null}
        <p className="mt-2 font-mono text-[11px] text-faint">Folder: {folder}</p>
        <div className="mt-5 flex flex-wrap gap-4 border border-line bg-surface px-3 py-2.5">
          {STATUSES.map((status) => {
            const count = tasks.filter((task) => task.status === status).length;
            return (
              <div key={status} className="min-w-16">
                <div className={`font-mono text-[16px] ${statusText[status]}`}>{count}</div>
                <div className="text-[11px] text-faint">{STATUS_LABEL[status]}</div>
              </div>
            );
          })}
          <div className="min-w-16">
            <div className="font-mono text-[16px] text-completed">{verified}</div>
            <div className="text-[11px] text-faint">Verified</div>
          </div>
          <div className="min-w-16">
            <div className="font-mono text-[16px] text-approval">{yours}</div>
            <div className="text-[11px] text-faint">Need you</div>
          </div>
        </div>
        <section className="mt-6">
          <h2 className="text-[11px] uppercase tracking-[0.12em] text-faint">Activity</h2>
          {events.length ? (
            <ul className="mt-2 divide-y divide-line border border-line">
              {events.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => selectTask(event.taskId)}
                    className="flex w-full items-baseline gap-3 px-3 py-1.5 text-left hover:bg-surface"
                  >
                    <span className="font-mono text-[10px] text-faint">{formatClock(event.at)}</span>
                    <span className={`text-[12px] ${toneText[event.tone]}`}>{event.message}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12px] text-muted">Nothing has happened in this project yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
