import { Check, Clock, Eye, ShieldCheck, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../../model/format";
import { stageOf } from "../../model/stage";
import { incoming, outgoing } from "../../model/selectors";
import { GATE_LABEL } from "../../model/types";
import { dependencySatisfied } from "../../model/verify";
import { useShepherd } from "../../store";
import { Card, StageBadge } from "../ui";
import { useSelectedTask } from "./useSelectedTask";

export function Overview() {
  const task = useSelectedTask();
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const selectTask = useShepherd((store) => store.selectTask);
  const upstream = incoming(task.id, deps);
  const downstream = outgoing(task.id, deps);
  const reviewed = task.verification.some((check) => check.kind === "review");

  return (
    <div className="space-y-3">
      <Card title="Goal">
        <p className="text-[14px] leading-6 text-text [overflow-wrap:anywhere]">{task.objective || "No goal written yet. Add one on the Edit tab."}</p>
        {task.description && task.description !== task.objective ? (
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-muted [overflow-wrap:anywhere]">{task.description}</p>
        ) : null}
      </Card>
      {task.acceptance.length ? (
        <Card title="Done when">
          <ul className="space-y-1.5">
            {task.acceptance.map((line, index) => (
              <li key={index} className="flex gap-2.5 text-[13px] leading-5 text-text">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-faint" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{line}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {task.runner === "agent" ? (
        <div className="flex flex-wrap gap-1.5">
          {task.autoRun ? <Chip icon={<Zap size={12} />}>Starts automatically</Chip> : null}
          {task.independent ? <Chip icon={<Eye size={12} />}>Reviews independently</Chip> : null}
          {task.checkCommand ? <Chip icon={<ShieldCheck size={12} />}>{reviewed ? "Checked, then you review" : "Its check alone verifies it"}</Chip> : null}
        </div>
      ) : null}
      {upstream.length ? (
        <Card title="Needs">
          <ul className="space-y-1">
            {upstream.map((dep) => {
              const source = tasks.find((item) => item.id === dep.source);
              const open = dependencySatisfied(dep, source);
              return (
                <Link
                  key={dep.id}
                  open={open}
                  onClick={() => selectTask(dep.source)}
                  name={source?.name ?? dep.source}
                  note={source ? <StageBadge stage={stageOf(source, tasks, deps)} /> : null}
                  detail={GATE_LABEL[dep.gate]}
                />
              );
            })}
          </ul>
        </Card>
      ) : null}
      {downstream.length ? (
        <Card title="Unlocks">
          <ul className="space-y-1">
            {downstream.map((dep) => {
              const target = tasks.find((item) => item.id === dep.target);
              return (
                <Link
                  key={dep.id}
                  open={dependencySatisfied(dep, task)}
                  onClick={() => selectTask(dep.target)}
                  name={target?.name ?? dep.target}
                  note={target ? <StageBadge stage={stageOf(target, tasks, deps)} /> : null}
                  detail={GATE_LABEL[dep.gate]}
                />
              );
            })}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-[12px] text-muted">
      {icon}
      {children}
    </span>
  );
}

function Link({ open, onClick, name, note, detail }: { open: boolean; onClick: () => void; name: string; note: ReactNode; detail: string }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-black/25">
        <span className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", open ? "bg-completed/20 text-completed" : "bg-white/5 text-queued")}>
          {open ? <Check size={12} strokeWidth={3} /> : <Clock size={11} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-text">{name}</span>
          <span className="block text-[11px] text-faint">{detail}</span>
        </span>
        {note}
      </button>
    </li>
  );
}
