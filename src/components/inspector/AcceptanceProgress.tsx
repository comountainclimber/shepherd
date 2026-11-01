import { CheckCircle2, Circle } from "lucide-react";
import { acceptanceItems, markedCount } from "../../model/acceptance";
import type { Task } from "../../model/types";

export function AcceptanceCount({ task }: { task: Task }) {
  if (task.runner !== "agent" || !task.acceptance.length) return null;
  return <span className="shrink-0 text-[11px] text-muted" title="Done when items the agent says it has met" aria-label={`Agent says ${markedCount(task)} of ${task.acceptance.length} Done when items met`}>{markedCount(task)} of {task.acceptance.length}</span>;
}

export function AcceptanceProgress({ task }: { task: Task }) {
  if (task.runner !== "agent" || !task.acceptance.length) return null;
  return <section className="rounded-lg border border-line p-3" aria-label="Done when progress">
    <div className="flex items-baseline justify-between gap-2"><h3 className="text-[12px] font-medium text-text">Done when</h3><AcceptanceCount task={task} /></div>
    <p className="mt-1 text-[11px] leading-4 text-faint">What the agent says it has met. Checks decide when the step is done.</p>
    <ol className="mt-3 space-y-3">
      {acceptanceItems(task.acceptance).map((item) => {
        const mark = task.acceptanceMarks?.[item.key];
        const Icon = mark ? CheckCircle2 : Circle;
        return <li key={item.key} className="flex items-start gap-2 text-[12px] leading-5 [overflow-wrap:anywhere]">
          <Icon size={15} aria-hidden className={`mt-0.5 shrink-0 ${mark ? "text-completed" : "text-faint"}`} />
          <div className="min-w-0"><p className="text-text">{item.number}. {item.text}</p><p className={`text-[11px] ${mark ? "text-completed" : "text-faint"}`}>{mark ? "Agent says: met" : "Not marked"}</p>{mark ? <p className="whitespace-pre-wrap text-muted">{mark.note}</p> : null}</div>
        </li>;
      })}
    </ol>
  </section>;
}
