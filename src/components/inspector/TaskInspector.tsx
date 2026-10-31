import { Check, Clock, GitMerge, LoaderCircle, Pause, Play, RefreshCw, Square, Undo2, X } from "lucide-react";
import { cx } from "../../model/format";
import { assigneeFor, failedCheck, reviewPending, stageHint, stageOf, waitingFor, type Stage } from "../../model/stage";
import type { PanelTab, Task } from "../../model/types";
import { markComplete, mergeTask, runTask, stopTask } from "../../runner/live";
import { useShepherd } from "../../store";
import { Avatar, Button, StageBadge, Tabs, stageBg, stageBorder } from "../ui";
import { Edit } from "./Edit";
import { Log } from "./Log";
import { Overview } from "./Overview";
import { Verification } from "./Verification";

export function TaskInspector() {
  const taskId = useShepherd((store) => store.ui.selectedTaskId);
  const task = useShepherd((store) => store.state.tasks.find((item) => item.id === taskId));
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const tab = useShepherd((store) => store.ui.panelTab);
  const setPanelTab = useShepherd((store) => store.setPanelTab);
  const setInspectorOpen = useShepherd((store) => store.setInspectorOpen);
  if (!task) return null;
  const stage = stageOf(task, tasks, deps);
  const assignee = assigneeFor(task);
  const proofNeedsYou = (task.status === "completed" && !!reviewPending(task)) || !!failedCheck(task);
  const tabs: { id: PanelTab; label: string; alert?: boolean }[] = [
    { id: "overview", label: "Overview" },
    { id: "proof", label: "Proof", alert: proofNeedsYou && tab !== "proof" },
    { id: "log", label: "Log" },
    { id: "edit", label: "Edit" },
  ];

  return (
    <aside
      className={cx(
        "enter absolute bottom-3 right-3 top-3 z-20 flex w-[440px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-xl border bg-surface shadow-2xl",
        stageBorder[stage],
      )}
    >
      <div className={cx("h-1 shrink-0", stageBg[stage], stage === "running" && "stripes")} />
      <header className="space-y-3 px-4 pb-3 pt-3">
        <div className="flex items-start gap-3">
          <Avatar kind={assignee.kind} size={36} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold leading-tight text-text">{task.name}</h2>
            <div className="mt-1 flex items-center gap-2">
              <StageBadge stage={stage} />
              <span className="truncate text-[12px] text-muted">{assignee.name}</span>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setInspectorOpen(false)}
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text"
          >
            <X size={16} />
          </button>
        </div>
        <NextStep task={task} stage={stage} />
      </header>
      <div className="px-4">
        <Tabs tabs={tabs} value={tab} onChange={(id) => setPanelTab(id as PanelTab)} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {tab === "overview" ? <Overview /> : null}
        {tab === "proof" ? <Verification /> : null}
        {tab === "log" ? <Log /> : null}
        {tab === "edit" ? <Edit /> : null}
      </div>
    </aside>
  );
}

/** The one thing to do next. */
function NextStep({ task, stage }: { task: Task; stage: Stage }) {
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const dispatch = useShepherd((store) => store.dispatch);
  const tab = useShepherd((store) => store.ui.panelTab);
  const setPanelTab = useShepherd((store) => store.setPanelTab);
  const hint = stageHint(task, stage, tasks, deps);
  const review = reviewPending(task);

  switch (stage) {
    case "ready":
      return (
        <div className="flex items-center gap-3">
          <Button size="lg" variant="primary" disabled={!task.agentId} onClick={() => void runTask(task.id)}>
            <Play size={15} /> Start
          </Button>
          <p className="text-[12px] leading-5 text-muted">
            {task.agentId ? `${assigneeFor(task).name} works on its own branch.` : "Assign an agent on the Edit tab first."}
          </p>
        </div>
      );
    case "running":
      return (
        <div className="space-y-2">
          <p className="line-clamp-2 text-[13px] leading-5 text-running">{task.activity || "Running…"}</p>
          <div className="flex gap-2">
            <Button onClick={() => void stopTask(task.id, "blocked")}>
              <Pause size={14} /> Pause
            </Button>
            <Button variant="quiet" onClick={() => void stopTask(task.id, "queued")}>
              <Square size={12} /> Stop
            </Button>
          </div>
        </div>
      );
    case "checking":
    case "updating":
      return (
        <p className="flex items-center gap-2 text-[13px] text-checking">
          <LoaderCircle size={15} className="animate-spin" /> {hint}
        </p>
      );
    case "needs-you":
      if (task.status === "completed" && review) {
        return (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button size="lg" variant="go" onClick={() => dispatch({ type: "setCheck", taskId: task.id, checkId: review.id, state: "passed" })}>
                <Check size={16} /> Accept
              </Button>
              <Button size="lg" variant="danger" onClick={() => dispatch({ type: "setCheck", taskId: task.id, checkId: review.id, state: "failed" })}>
                <Undo2 size={16} /> Send back
              </Button>
            </div>
            {tab !== "proof" ? (
              <button type="button" className="text-[12px] text-approval hover:underline" onClick={() => setPanelTab("proof")}>
                Look at the proof before you decide
              </button>
            ) : (
              <p className="text-[12px] text-muted">Accepting verifies it. Sending it back fails it, and you can retry with an instruction.</p>
            )}
          </div>
        );
      }
      return (
        <Button size="lg" variant="primary" onClick={() => void markComplete(task.id)}>
          <Check size={16} /> Mark done
        </Button>
      );
    case "failed":
      return (
        <div className="space-y-2">
          <p className="line-clamp-3 text-[13px] leading-5 text-failed [overflow-wrap:anywhere]">{task.blocker ?? hint}</p>
          <div className="flex gap-2">
            {task.runner === "agent" ? (
              <Button size="lg" variant="primary" onClick={() => void runTask(task.id)}>
                <RefreshCw size={15} /> Retry
              </Button>
            ) : null}
            {failedCheck(task) && tab !== "proof" ? (
              <Button size="lg" onClick={() => setPanelTab("proof")}>
                See why
              </Button>
            ) : null}
          </div>
        </div>
      );
    case "paused":
      return (
        <div className="flex gap-2">
          <Button size="lg" variant="primary" onClick={() => void runTask(task.id)}>
            <Play size={15} /> Resume
          </Button>
          <Button variant="quiet" onClick={() => void stopTask(task.id, "queued")}>
            Stop
          </Button>
        </div>
      );
    case "waiting": {
      const blockers = waitingFor(task, tasks, deps);
      return (
        <p className="flex items-start gap-2 text-[13px] text-muted">
          <Clock size={15} className="mt-0.5 shrink-0" />
          <span>
            Waiting on <span className="font-medium text-text">{blockers.map((item) => item.name).join(", ") || "its upstream tasks"}</span>.
            {task.runner === "agent" && task.autoRun ? " It starts automatically after that." : ""}
          </span>
        </p>
      );
    }
    case "verified":
      return (
        <div className="flex flex-wrap items-center gap-2">
          {task.git && !task.git.merged ? (
            <Button size="lg" variant="primary" onClick={() => void mergeTask(task.id)}>
              <GitMerge size={15} /> Merge into {task.git.target}
            </Button>
          ) : (
            <p className="flex items-center gap-2 text-[13px] text-completed">
              <Check size={15} /> {task.git?.merged ? `Verified and merged into ${task.git.merged.into}` : "Verified"}
            </p>
          )}
          {task.runner === "agent" ? (
            <Button variant="quiet" onClick={() => void runTask(task.id)}>
              Run again
            </Button>
          ) : null}
        </div>
      );
  }
}
