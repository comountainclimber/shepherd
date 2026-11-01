import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useState } from "react";
import { DEFAULT_AGENT_ID, newStep } from "../../model/factory";
import { cx } from "../../model/format";
import type { Issue, Task } from "../../model/types";
import { isFullyVerified } from "../../model/verify";
import { useShepherd } from "../../store";
import { Button, TextArea } from "../ui";

/** Problems found in a step's work and left for later, each of which can become a step that fixes it. */
export function KnownIssues({ task }: { task: Task }) {
  const tasks = useShepherd((store) => store.state.tasks);
  const dispatch = useShepherd((store) => store.dispatch);
  const focusTask = useShepherd((store) => store.focusTask);
  const setPanelTab = useShepherd((store) => store.setPanelTab);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const issues = task.issues ?? [];

  const note = () => {
    if (!text.trim()) return;
    dispatch({ type: "noteIssue", id: task.id, text });
    setText("");
    setAdding(false);
  };
  const makeStep = (issue: Issue) => {
    const step = newStep(task.projectId, fixName(issue.text), fixPrompt(task, issue), DEFAULT_AGENT_ID);
    dispatch({ type: "fixIssue", id: task.id, issueId: issue.id, task: step });
    focusTask(step.id);
    setPanelTab("step");
  };

  return (
    <div className="space-y-2">
      {issues.length ? (
        <ul className="space-y-1.5">
          {issues.map((issue) => {
            const fix = issue.stepId ? tasks.find((item) => item.id === issue.stepId) : undefined;
            const fixed = !!fix && isFullyVerified(fix);
            return (
              <li key={issue.id} className={cx("rounded-lg border px-2.5 py-2", fixed ? "border-line" : "border-approval/30 bg-approval/5")}>
                <div className="flex items-start gap-2">
                  {fixed ? (
                    <CircleCheck size={14} className="mt-0.5 shrink-0 text-completed" />
                  ) : (
                    <CircleAlert size={14} className="mt-0.5 shrink-0 text-approval" />
                  )}
                  <p className={cx("min-w-0 flex-1 whitespace-pre-wrap text-[12px] leading-5 [overflow-wrap:anywhere]", fixed ? "text-muted" : "text-text")}>
                    {issue.text}
                  </p>
                  {fix ? null : (
                    <button
                      type="button"
                      aria-label="Remove this issue"
                      title="Remove this issue"
                      className="-mr-1 shrink-0 rounded p-0.5 text-faint hover:bg-surface-2 hover:text-text"
                      onClick={() => dispatch({ type: "dropIssue", id: task.id, issueId: issue.id })}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="mt-1 pl-[22px] text-[11px]">
                  {fix ? (
                    <button type="button" className="text-muted hover:text-text hover:underline" onClick={() => focusTask(fix.id)}>
                      {fixed ? "Fixed by" : "Being fixed in"} “{fix.name}”
                    </button>
                  ) : (
                    <button type="button" className="font-medium text-approval hover:underline" onClick={() => makeStep(issue)}>
                      Make it a step
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {adding ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            note();
          }}
        >
          <TextArea
            autoFocus
            rows={3}
            value={text}
            aria-label="Known issue"
            placeholder="What is wrong, and how to see it"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                note();
              }
              if (event.key === "Escape") setAdding(false);
            }}
          />
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={!text.trim()}>
              Note it
            </Button>
            <Button type="button" size="sm" variant="quiet" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-[11px] leading-4 text-faint">It stays on this step for later, and the steps after this one are told about it. Nothing reruns.</p>
        </form>
      ) : (
        <button type="button" className="text-[12px] text-muted hover:text-text hover:underline" onClick={() => setAdding(true)}>
          Note a known issue
        </button>
      )}
    </div>
  );
}

/** A short step name for a fix, from the first sentence of the issue. */
export function fixName(text: string): string {
  const first = text.trim().split(/\n|(?<=[.!?])\s/)[0]!.replace(/[.!?:]+$/, "");
  return `Fix: ${first.length > 52 ? `${first.slice(0, 52).replace(/\s+\S*$/, "")}…` : first}`;
}

export function fixPrompt(task: Task, issue: Issue): string {
  return `${issue.text.trim()}\n\nSomeone noted this in "${task.name}" and left it for later. Fix it without changing what already works, and say how to see that it is fixed.`;
}
