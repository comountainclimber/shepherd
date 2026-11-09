import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cx, formatDuration } from "../../model/format";
import { tint } from "../../model/graphs";
import { choiceLabel } from "../../model/models";
import { assigneeFor, needsYou, nextStep, openIssues, STEP_LABEL, stageHint, stageOf } from "../../model/stage";
import { useShepherd } from "../../store";
import { useModels } from "../useModels";
import { useNextStep } from "../useNextStep";
import { AcceptanceCount } from "../inspector/AcceptanceProgress";
import { Avatar, CheckDots, StageBadge, stageBg } from "../ui";

/** `color` is the graph's; the node is tinted with it. */
export type TaskNodeData = { taskId: string; dimmed: boolean; color: string };
export type TaskFlowNode = Node<TaskNodeData, "task">;

export const NODE_WIDTH = 256;
export const NODE_HEIGHT = 112;

export function TaskNodeView({ data, selected }: NodeProps<TaskFlowNode>) {
  const task = useShepherd((store) => store.state.tasks.find((item) => item.id === data.taskId));
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const takeStep = useNextStep();
  const catalog = useModels();
  if (!task) return null;
  const choice = choiceLabel(task, catalog);

  const stage = stageOf(task, tasks, deps);
  const step = needsYou(task, tasks, deps) ? nextStep(task, stage) : null;
  const running = stage === "running";
  const hint = stageHint(task, stage, tasks, deps);
  const issues = stage === "verified" && openIssues(task, tasks).length > 0;

  return (
    <div
      className={cx(
        "group relative overflow-hidden rounded-xl border-2 bg-surface text-left shadow-[0_4px_14px_rgb(0_0_0/0.3)] transition-opacity",
        selected && "ring-2 ring-brass ring-offset-2 ring-offset-bg",
        data.dimmed && "opacity-30",
      )}
      style={{
        width: NODE_WIDTH,
        borderColor: selected ? "var(--color-brass)" : tint(data.color, 70),
        backgroundImage: `linear-gradient(180deg, ${tint(data.color, 16)}, var(--color-surface) 70%)`,
      }}
    >
      <div className="flex items-start gap-2.5 px-3 pt-3">
        <Avatar kind={assigneeFor(task).kind} size={28} />
        <div className="min-w-0 flex-1">
          <div className={cx("truncate text-[14px] font-semibold leading-tight", stage === "waiting" ? "text-muted" : "text-text")}>{task.name}</div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <StageBadge stage={stage} />
            <AcceptanceCount task={task} />
          </div>
        </div>
      </div>
      <div className="px-3 pb-3 pt-2">
        <div className={cx("truncate text-[12px]", running ? "text-running" : issues ? "text-approval" : "text-muted")} title={hint}>
          {hint}
        </div>
        <div className="mt-2 flex h-6 items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <CheckDots checks={task.verification} />
            {choice ? <span className="truncate rounded-md bg-white/5 px-1.5 py-px text-[11px] text-muted">{choice}</span> : null}
          </span>
          {step ? (
            <button
              type="button"
              className={cx(
                "nodrag rounded-md px-2.5 py-1 text-[12px] font-medium hover:brightness-110",
                stage === "failed" ? "bg-failed text-rose-950" : "bg-brass text-ink",
              )}
              onClick={(event) => {
                event.stopPropagation();
                takeStep(task, step);
              }}
            >
              {STEP_LABEL[step]}
            </button>
          ) : (
            <span className="font-mono text-[11px] text-faint">{task.elapsedMs && !running ? formatDuration(task.elapsedMs) : ""}</span>
          )}
        </div>
      </div>
      {running ? <div className={cx("stripes absolute inset-x-0 bottom-0 h-1", stageBg[stage])} /> : null}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
