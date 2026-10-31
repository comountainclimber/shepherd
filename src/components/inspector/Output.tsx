import { GitMerge, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { formatClock } from "../../model/format";
import type { Task } from "../../model/types";
import { isFullyVerified } from "../../model/verify";
import { mergeTask } from "../../runner/live";
import { Button, Card } from "../ui";
import { useSelectedTask } from "./useSelectedTask";

/** What the step produced: the agent's report, the files it changed, and merging them. */
export function Output() {
  const task = useSelectedTask();
  const done = isFullyVerified(task);
  return (
    <div className="space-y-3">
      <Report task={task} />
      <Changes task={task} />
      {task.git && task.runner === "agent" ? <Merge key={task.id} task={task} done={done} /> : null}
    </div>
  );
}

function Report({ task }: { task: Task }) {
  if (task.runner === "human") {
    return (
      <Card title="Report">
        <p className="text-[13px] leading-5 text-muted">
          {task.status === "completed" ? "You marked this step done." : "This step is yours. Mark it done when it is, and the steps after it start."}
        </p>
      </Card>
    );
  }
  if (task.status === "running") {
    return (
      <Card title="Report">
        <p className="flex items-start gap-2 text-[13px] leading-5 text-running">
          <LoaderCircle size={14} className="mt-0.5 shrink-0 animate-spin" />
          <span className="[overflow-wrap:anywhere]">{task.activity || "Working…"}</span>
        </p>
        <p className="mt-2 text-[11px] text-faint">The full report shows up here when the agent finishes.</p>
      </Card>
    );
  }
  const text = task.output?.trim() || (task.status === "completed" ? task.activity : "");
  return (
    <Card title="Report" right={task.git?.head ? <span className="font-mono text-[11px] text-faint">{task.git.head}</span> : null}>
      {text ? (
        <div className="max-h-[50vh] overflow-auto whitespace-pre-wrap text-[13px] leading-5 text-text [overflow-wrap:anywhere]">{text}</div>
      ) : (
        <p className="text-[13px] leading-5 text-muted">
          {task.status === "failed" ? (task.blocker ?? "The run failed before the agent reported.") : "Nothing yet. The agent's report shows up here after the step runs."}
        </p>
      )}
      {text ? <p className="mt-2 text-[11px] text-faint">The steps after this one get this report with their prompt.</p> : null}
    </Card>
  );
}

function Changes({ task }: { task: Task }) {
  if (!task.previews.length && !task.filesChanged.length) return null;
  const unshown = task.filesChanged.filter((path) => !task.previews.some((preview) => preview.path === path));
  return (
    <Card
      title="What it changed"
      right={task.git ? <span className="truncate font-mono text-[11px] text-faint">{task.git.branch}</span> : null}
    >
      <ul className="space-y-1.5">
        {task.previews.map((preview, index) => {
          const added = preview.text.split("\n").filter((line) => line.startsWith("+")).length;
          const removed = preview.text.split("\n").filter((line) => line.startsWith("-")).length;
          return (
            <li key={preview.path}>
              <details open={index < 2} className="overflow-hidden rounded-lg border border-line bg-black/25">
                <summary className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 font-mono text-[11px] text-text">
                  <span className="min-w-0 flex-1 truncate">{preview.path}</span>
                  {task.git ? (
                    <span className="shrink-0">
                      <span className="text-completed">+{added}</span> <span className="text-failed">−{removed}</span>
                    </span>
                  ) : null}
                </summary>
                {task.git ? (
                  <Diff text={preview.text} />
                ) : (
                  <pre className="max-h-52 overflow-auto whitespace-pre-wrap px-2 py-2 font-mono text-[11px] leading-5 text-text">{preview.text}</pre>
                )}
              </details>
            </li>
          );
        })}
      </ul>
      {unshown.length ? (
        <div className="mt-2 text-[12px] text-muted">
          Also changed: <span className="font-mono text-[11px] text-text">{unshown.join(", ")}</span>
        </div>
      ) : null}
      <p className="mt-2 text-[11px] text-faint">Only this step's own changes. Work merged in from earlier steps is left out.</p>
    </Card>
  );
}

function Diff({ text }: { text: string }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all border-t border-line py-1 font-mono text-[11px] leading-5">
      {text.split("\n").map((line, index) => (
        <div
          key={index}
          className={
            line.startsWith("+")
              ? "bg-completed/10 px-2 text-completed"
              : line.startsWith("-")
                ? "bg-failed/10 px-2 text-failed"
                : line.startsWith("@@")
                  ? "px-2 text-faint"
                  : "px-2 text-text"
          }
        >
          {line || " "}
        </div>
      ))}
    </pre>
  );
}

function Merge({ task, done }: { task: Task; done: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const git = task.git!;
  return (
    <Card title="Merge" right={git.merged ? <span className="text-[11px] font-medium uppercase text-completed">Merged</span> : null}>
      <p className="text-[13px] leading-5 text-muted">
        {git.merged
          ? `Merged into ${git.merged.into} as ${git.merged.sha} at ${formatClock(git.merged.at)}.`
          : done
            ? `Brings ${git.branch}, with the earlier steps' work, into ${git.target} in the project folder. Merging the whole plan at once is in the step list.`
            : `Once it is done, you can merge ${git.branch} into ${git.target}.`}
      </p>
      {error ? <p className="mt-1 text-[12px] leading-5 text-failed">{error}</p> : null}
      {git.merged ? null : (
        <Button
          className="mt-2.5"
          variant="ghost"
          disabled={!done || busy || task.status === "running"}
          onClick={async () => {
            setBusy(true);
            setError(await mergeTask(task.id));
            setBusy(false);
          }}
        >
          <GitMerge size={15} /> {busy ? "Merging…" : `Merge just this step into ${git.target}`}
        </Button>
      )}
    </Card>
  );
}
