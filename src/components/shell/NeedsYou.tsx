import { ChevronDown, UserRound } from "lucide-react";
import { useState } from "react";
import { cx } from "../../model/format";
import { assigneeFor, needsYou, nextStep, STEP_LABEL, stageHint, stageOf } from "../../model/stage";
import { tasksForProject } from "../../model/selectors";
import { useShepherd } from "../../store";
import { useNextStep } from "../useNextStep";
import { Avatar } from "../ui";

/** Everything in this project waiting on you, each with the one button that moves it along. */
export function NeedsYou() {
  const state = useShepherd((store) => store.state);
  const projectId = useShepherd((store) => store.ui.projectId);
  const selectTask = useShepherd((store) => store.selectTask);
  const takeStep = useNextStep();
  const [open, setOpen] = useState(true);
  const tasks = tasksForProject(state, projectId);
  if (!tasks.length) return null;
  const waiting = tasks.filter((task) => needsYou(task, state.tasks, state.dependencies));
  const running = tasks.filter((task) => task.status === "running").length;

  if (!waiting.length) {
    return (
      <div className="absolute bottom-4 left-4 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] text-muted shadow-xl">
        {running ? `Nothing needs you. ${running} ${running === 1 ? "task is" : "tasks are"} running.` : "Nothing needs you right now."}
      </div>
    );
  }

  return (
    <div className="enter absolute bottom-4 left-4 z-10 w-[340px] overflow-hidden rounded-xl border border-approval/50 bg-surface shadow-2xl">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <UserRound size={15} className="text-approval" />
        <span className="flex-1 text-[13px] font-medium text-text">Needs you</span>
        <span className="rounded-md bg-approval/15 px-1.5 font-mono text-[12px] text-approval">{waiting.length}</span>
        <ChevronDown size={14} className={cx("text-muted transition-transform", !open && "rotate-180")} />
      </button>
      {open ? (
        <ul className="max-h-[38vh] space-y-1 overflow-auto px-2 pb-2">
          {waiting.map((task) => {
            const stage = stageOf(task, state.tasks, state.dependencies);
            const step = nextStep(task, stage);
            return (
              <li key={task.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                <Avatar kind={assigneeFor(task).kind} size={26} />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => selectTask(task.id)}>
                  <div className="truncate text-[13px] font-medium text-text">{task.name}</div>
                  <div className={cx("truncate text-[12px]", stage === "failed" ? "text-failed" : "text-muted")}>
                    {stageHint(task, stage, state.tasks, state.dependencies)}
                  </div>
                </button>
                {step ? (
                  <button
                    type="button"
                    onClick={() => takeStep(task, step)}
                    className={cx(
                      "shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium hover:brightness-110",
                      stage === "failed" ? "bg-failed text-rose-950" : "bg-brass text-ink",
                    )}
                  >
                    {STEP_LABEL[step]}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
