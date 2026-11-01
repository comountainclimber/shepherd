import type { WorkCheckResult, WorkVerdict } from "../../model/types";

export function verdictTone(verdict: WorkVerdict): string {
  return verdict === "met" ? "text-completed" : verdict === "not met" ? "text-failed" : "text-approval";
}

export function WorkVerdicts({ result, acceptance = [] }: { result: WorkCheckResult; acceptance?: string[] }) {
  return <div className="space-y-3 text-[12px] leading-5 [overflow-wrap:anywhere]">
    <ol className="space-y-2">
      {result.items.map((item) => <li key={item.key}>
        <p className={`font-medium ${verdictTone(item.verdict)}`}>Done when {item.item}: {item.verdict}</p>
        {acceptance[item.item - 1] ? <p className="text-text">{acceptance[item.item - 1]}</p> : null}
        <p className="whitespace-pre-wrap text-muted">{item.reason}</p>
      </li>)}
    </ol>
    {result.violations.length ? <div><p className="font-medium text-failed">Against the step's instructions</p><ul className="list-disc space-y-1 pl-4 text-muted">{result.violations.map((text, index) => <li key={index}>{text}</li>)}</ul></div> : null}
    {result.unrequested.length ? <div><p className="font-medium text-text">Not asked for</p><p className="text-faint">These changes alone do not fail the check.</p><ul className="list-disc space-y-1 pl-4 text-muted">{result.unrequested.map((text, index) => <li key={index}>{text}</li>)}</ul></div> : null}
  </div>;
}
