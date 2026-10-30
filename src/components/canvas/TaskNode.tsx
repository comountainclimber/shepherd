import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cx, formatAgent, formatDuration, statusLabel } from "../../model/format";
import { waitingOn } from "../../model/selectors";
import { CHECK_LABEL } from "../../model/types";
import { isFullyVerified } from "../../model/verify";
import { agentById } from "../../model/workspace";
import { useShepherd } from "../../store";
import { checkBg, statusBg, statusText } from "../ui";

export type TaskNodeData = { taskId: string; dimmed: boolean };
export type TaskFlowNode = Node<TaskNodeData, "task">;

export function TaskNodeView({ data, selected }: NodeProps<TaskFlowNode>) {
  const task = useShepherd((store) => store.state.tasks.find((item) => item.id === data.taskId));
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  if (!task) return null;

  const verified = isFullyVerified(task);
  const waiting = waitingOn(task, tasks, deps);
  const wait = task.status === "completed" ? null : (waiting ?? (task.status === "running" ? null : task.blocker));
  const yourTurn = task.runner === "human" && task.status === "queued" && !waiting;
  const running = task.status === "running";

  return (
    <div
      className={cx(
        "w-[248px] rounded-md border bg-surface text-left",
        selected ? "border-brass" : "border-line",
        data.dimmed && "opacity-40",
      )}
    >
      <div className="flex">
        <div className={cx("w-[3px] shrink-0 rounded-l-[5px]", statusBg[task.status], running && "rail-live")} />
        <div className="min-w-0 flex-1 px-2.5 py-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-text">{task.name}</div>
            <span className={cx("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", statusBg[task.status])} />
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-muted">
            <span className="truncate">{task.runner === "human" ? "You" : formatAgent(agentById(task.agentId))}</span>
            {task.git ? (
              <>
                <span className="text-faint">·</span>
                <span className="truncate font-mono text-[10px]">{task.git.branch}</span>
              </>
            ) : null}
          </div>
          {running ? <div className="mt-1.5 truncate text-[11px] text-running">{task.activity}</div> : null}
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {task.verification.map((check) => (
                <span
                  key={check.id}
                  title={`${CHECK_LABEL[check.kind]}: ${check.state}`}
                  className={cx("h-1.5 w-1.5 rounded-[1px]", checkBg[check.state])}
                />
              ))}
            </div>
            <span className="font-mono text-[10px] text-faint">
              {!running && task.elapsedMs ? formatDuration(task.elapsedMs) : statusLabel(task.status)}
            </span>
          </div>
          {task.status === "completed" && !verified ? (
            <div className="mt-1.5 text-[10px] uppercase tracking-[0.08em] text-running">Needs your review</div>
          ) : null}
          {yourTurn ? (
            <div className="mt-1.5 text-[10px] uppercase tracking-[0.08em] text-approval">Your turn</div>
          ) : null}
          {verified ? (
            <div className="mt-1.5 text-[10px] uppercase tracking-[0.08em] text-completed">
              {task.git?.merged ? `Verified · merged into ${task.git.merged.into}` : "Verified"}
            </div>
          ) : null}
          {task.status === "failed" || task.status === "blocked" ? (
            <div className={cx("mt-1.5 text-[10px] uppercase tracking-[0.08em]", statusText[task.status])}>
              {statusLabel(task.status)}
            </div>
          ) : null}
          {wait ? <div className="mt-1 truncate text-[11px] text-blocked">{wait}</div> : null}
        </div>
      </div>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
