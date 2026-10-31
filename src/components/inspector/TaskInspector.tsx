import { Check, Clock, LoaderCircle, Play, RefreshCw, Square, Undo2, X } from "lucide-react";
import { cx } from "../../model/format";
import { assigneeFor, failedCheck, reviewPending, stageHint, stageOf, waitingFor, type Stage } from "../../model/stage";
import type { PanelTab, Task } from "../../model/types";
import { markComplete, runTask, stopTask } from "../../runner/live";
import { useShepherd } from "../../store";
import { Avatar, Button, StageBadge, Tabs, stageBg, stageBorder } from "../ui";
import { Log } from "./Log";
import { Output } from "./Output";
import { Step } from "./Step";
import { Verification } from "./Verification";

export function TaskInspector() {
  const taskId = useShepherd((store) => store.ui.selectedTaskId);
  const task = useShepherd((store) => store.state.tasks.find((item) => item.id === taskId));
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const tab = useShepherd((store) => store.ui.panelTab);
  const dispatch = useShepherd((store) => store.dispatch);
  const setPanelTab = useShepherd((store) => store.setPanelTab);
  const setInspectorOpen = useShepherd((store) => store.setInspectorOpen);
  if (!task) return null;
  const stage = stageOf(task, tasks, deps);
  const assignee = assigneeFor(task);
  const checksNeedYou = (task.status === "completed" && !!reviewPending(task)) || !!failedCheck(task);
  const hasOutput = !!task.output || task.filesChanged.length > 0;
  const tabs: { id: PanelTab; label: string; alert?: boolean }[] = [
    { id: "step", label: "Step" },
    { id: "output", label: "Output", alert: hasOutput && stage === "needs-you" && tab !== "output" },
    { id: "checks", label: task.verification.length ? `Checks (${task.verification.length})` : "Checks", alert: checksNeedYou && tab !== "checks" },
    { id: "log", label: "Log" },
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
            <input
              value={task.name}
              placeholder="Name this step"
              aria-label="Step name"
              onChange={(event) => dispatch({ type: "updateTask", id: task.id, patch: { name: event.target.value } })}
              onKeyDown={(event) => (event.key === "Enter" || event.key === "Escape") && event.currentTarget.blur()}
              className="w-full bg-transparent text-[16px] font-semibold leading-tight text-text outline-none placeholder:text-faint"
            />
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
        {tab === "step" ? <Step /> : null}
        {tab === "output" ? <Output /> : null}
        {tab === "checks" ? <Verification /> : null}
        {tab === "log" ? <Log /> : null}
      </div>
    </aside>
  );
}

/** The one thing to do next. */
function NextStep({ task, stage }: { task: Task; stage: Stage }) {
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const planRunning = useShepherd((store) => !!store.state.projects.find((project) => project.id === task.projectId)?.running);
  const dispatch = useShepherd((store) => store.dispatch);
  const tab = useShepherd((store) => store.ui.panelTab);
  const setPanelTab = useShepherd((store) => store.setPanelTab);
  const hint = stageHint(task, stage, tasks, deps);
  const review = reviewPending(task);

  switch (stage) {
    case "ready":
      if (planRunning && task.agentId) {
        return (
          <p className="flex items-center gap-2 text-[13px] text-muted">
            <LoaderCircle size={15} className="animate-spin" /> Starting as part of the plan…
          </p>
        );
      }
      return (
        <div className="flex items-center gap-3">
          <Button size="lg" variant="ghost" disabled={!task.agentId || !task.name.trim()} onClick={() => void runTask(task.id)}>
            <Play size={15} /> Run just this step
          </Button>
          <p className="text-[12px] leading-5 text-muted">
            {!task.agentId ? "Pick who does it below first." : !task.name.trim() ? "Name it first." : "Or press Run under the steps to run them all."}
          </p>
        </div>
      );
    case "running":
      return (
        <div className="space-y-2">
          <p className="line-clamp-2 text-[13px] leading-5 text-running [overflow-wrap:anywhere]">{task.activity || "Running…"}</p>
          <Button onClick={() => void stopTask(task.id, "blocked")}>
            <Square size={12} /> Stop
          </Button>
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
            {tab !== "output" ? (
              <button type="button" className="text-[12px] text-approval hover:underline" onClick={() => setPanelTab("output")}>
                Read what it did before you decide
              </button>
            ) : (
              <p className="text-[12px] text-muted">Accepting lets the next steps start. Sending it back fails it, and you can retry with an instruction.</p>
            )}
          </div>
        );
      }
      return (
        <div className="flex items-center gap-3">
          <Button size="lg" variant="primary" onClick={() => void markComplete(task.id)}>
            <Check size={16} /> Mark done
          </Button>
          <p className="text-[12px] leading-5 text-muted">The steps after it start once you do.</p>
        </div>
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
            {failedCheck(task) && tab !== "checks" ? (
              <Button size="lg" onClick={() => setPanelTab("checks")}>
                See why
              </Button>
            ) : null}
          </div>
        </div>
      );
    case "paused":
      return (
        <Button size="lg" variant="primary" onClick={() => void runTask(task.id)}>
          <Play size={15} /> Resume
        </Button>
      );
    case "waiting": {
      const blockers = waitingFor(task, tasks, deps);
      return (
        <p className="flex items-start gap-2 text-[13px] text-muted">
          <Clock size={15} className="mt-0.5 shrink-0" />
          <span>
            Starts after <span className="font-medium text-text">{blockers.map((item) => item.name || "Untitled step").join(", ") || "the steps before it"}</span>.
            {planRunning ? "" : " Press Run under the steps to start the plan."}
          </span>
        </p>
      );
    }
    case "verified":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex items-center gap-2 text-[13px] text-completed">
            <Check size={15} /> {task.git?.merged ? `Done and merged into ${task.git.merged.into}` : "Done"}
          </p>
          {task.runner === "agent" ? (
            <Button variant="quiet" onClick={() => void runTask(task.id)}>
              Run again
            </Button>
          ) : null}
        </div>
      );
  }
}
