import { useState } from "react";
import { formatClock } from "../../model/format";
import { outgoing } from "../../model/selectors";
import { CHECK_LABEL, GATE_LABEL, type Task, type VerificationCheck } from "../../model/types";
import { dependencySatisfied, isFullyVerified } from "../../model/verify";
import { mergeTask, runCheck } from "../../runner/live";
import { useShepherd } from "../../store";
import { Button } from "../ui";
import { useSelectedTask } from "./useSelectedTask";

const noteTone = {
  completed: "border-completed/30 bg-completed/10 text-completed",
  approval: "border-approval/30 bg-approval/10 text-approval",
  running: "border-running/30 bg-running/10 text-running",
  failed: "border-failed/30 bg-failed/10 text-failed",
  queued: "border-line bg-surface-2 text-muted",
};

function verificationNote(task: Task, verified: boolean): { tone: keyof typeof noteTone; text: string } {
  if (verified) {
    return { tone: "completed", text: task.runner === "human" ? "You signed this off." : "You accepted this task's output." };
  }
  if (task.runner === "human") {
    return { tone: "approval", text: "This task is yours. Mark it complete in Actions when it is done. Your sign-off is the verification." };
  }
  if (task.status === "completed") {
    return {
      tone: "running",
      text: "The agent says it finished. That is not verification. Read what it wrote below, then accept or reject it.",
    };
  }
  if (task.status === "running") return { tone: "running", text: "The agent is running. What it writes shows up here when it finishes." };
  if (task.status === "failed" && task.verification.some((check) => check.kind === "command" && check.state === "failed")) {
    return { tone: "failed", text: "Shepherd's check failed. Its output is below. Retry from Actions and the agent gets that output." };
  }
  if (task.status === "failed") return { tone: "failed", text: "This run failed or you rejected it. Retry it from Actions, with an instruction if it needs one." };
  return { tone: "queued", text: "Nothing to review yet. Run the task first." };
}

export function Verification() {
  const task = useSelectedTask();
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const dispatch = useShepherd((store) => store.dispatch);
  const selectTask = useShepherd((store) => store.selectTask);
  const verified = isFullyVerified(task);
  const reviewable = task.status === "completed";
  const note = verificationNote(task, verified);
  const downstream = outgoing(task.id, deps);
  const unshown = task.filesChanged.filter((path) => !task.previews.some((preview) => preview.path === path));

  return (
    <div className="space-y-3">
      <p className={`border px-2 py-1.5 text-[12px] leading-5 ${noteTone[note.tone]}`}>{note.text}</p>
      {downstream.length ? (
        <section>
          <h3 className="mb-1 text-[11px] text-muted">Unblocks</h3>
          <ul className="space-y-1">
            {downstream.map((dep) => {
              const target = tasks.find((item) => item.id === dep.target);
              const open = dependencySatisfied(dep, task);
              return (
                <li key={dep.id} className="flex items-center gap-2 text-[12px]">
                  <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-brass" onClick={() => selectTask(dep.target)}>
                    {target?.name ?? dep.target}
                  </button>
                  <span className="font-mono text-[10px] text-faint">{GATE_LABEL[dep.gate]}</span>
                  <span className={`font-mono text-[10px] ${open ? "text-completed" : "text-blocked"}`}>{open ? "open" : "closed"}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {task.git && task.filesChanged.length ? (
        <h3 className="text-[11px] text-muted">
          What it changed on <span className="font-mono text-text">{task.git.branch}</span>, not counting upstream work
        </h3>
      ) : null}
      <ul className="space-y-2">
        {task.previews.map((preview) => (
          <li key={preview.path} className="border border-line">
            <div className="border-b border-line px-2 py-1 font-mono text-[11px] text-muted">{preview.path}</div>
            {task.git ? (
              <Diff text={preview.text} />
            ) : (
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap px-2 py-2 font-mono text-[11px] leading-5 text-text">{preview.text}</pre>
            )}
          </li>
        ))}
        {unshown.length ? (
          <li className="border border-line px-2 py-1.5">
            <div className="text-[11px] text-muted">Also changed, not shown here:</div>
            <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-text">
              {unshown.map((path) => (
                <li key={path} className="truncate">
                  {path}
                </li>
              ))}
            </ul>
          </li>
        ) : null}
        {task.verification.map((check) =>
          check.kind === "command" ? (
            <CommandCheck key={check.id} check={check} taskId={task.id} busy={task.status === "running"} />
          ) : (
            <li key={check.id} className="border border-line px-2 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-text">{CHECK_LABEL[check.kind]}</span>
                <span className={`font-mono text-[10px] uppercase ${check.state === "passed" ? "text-completed" : check.state === "failed" ? "text-failed" : "text-faint"}`}>
                  {check.state}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-5 text-muted">{check.evidence}</p>
              <div className="mt-1 font-mono text-[10px] text-faint">{formatClock(check.timestamp)}</div>
              <div className="mt-2 flex gap-1">
                <Button
                  variant="quiet"
                  disabled={!reviewable || check.state === "passed"}
                  onClick={() => dispatch({ type: "setCheck", taskId: task.id, checkId: check.id, state: "passed" })}
                >
                  Accept
                </Button>
                <Button
                  variant="quiet"
                  disabled={!reviewable || check.state === "failed"}
                  onClick={() => dispatch({ type: "setCheck", taskId: task.id, checkId: check.id, state: "failed" })}
                >
                  Reject
                </Button>
              </div>
            </li>
          ),
        )}
      </ul>
      {task.git && task.runner === "agent" ? <Merge key={task.id} task={task} verified={verified} /> : null}
    </div>
  );
}

function Diff({ text }: { text: string }) {
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all py-1 font-mono text-[11px] leading-5">
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

function Merge({ task, verified }: { task: Task; verified: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const git = task.git!;
  return (
    <section className="border border-line px-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-text">Merge</span>
        <span className={`font-mono text-[10px] uppercase ${git.merged ? "text-completed" : "text-faint"}`}>
          {git.merged ? "merged" : "not merged"}
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-5 text-muted">
        {git.merged
          ? `Merged into ${git.merged.into} as ${git.merged.sha} at ${formatClock(git.merged.at)}.`
          : verified
            ? `Merges ${git.branch} into ${git.target} in the project folder.`
            : `Once this task is verified, you can merge ${git.branch} into ${git.target}.`}
      </p>
      {error ? <p className="mt-1 text-[12px] leading-5 text-failed">{error}</p> : null}
      {git.merged ? null : (
        <Button
          className="mt-2"
          variant="primary"
          disabled={!verified || busy || task.status === "running"}
          onClick={async () => {
            setBusy(true);
            setError(await mergeTask(task.id));
            setBusy(false);
          }}
        >
          {busy ? "Merging…" : `Merge into ${git.target}`}
        </Button>
      )}
    </section>
  );
}

function CommandCheck({ check, taskId, busy }: { check: VerificationCheck; taskId: string; busy: boolean }) {
  const tone = check.running
    ? "text-running"
    : check.state === "passed"
      ? "text-completed"
      : check.state === "failed"
        ? "text-failed"
        : "text-faint";
  return (
    <li className="border border-line">
      <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-1.5">
        <span className="text-[12px] text-text">{CHECK_LABEL.command}</span>
        <span className={`font-mono text-[10px] uppercase ${tone}`}>{check.running ? "running" : check.state}</span>
      </div>
      <div className="space-y-1.5 px-2 py-2">
        <code className="block break-all font-mono text-[11px] text-brass">$ {check.command}</code>
        <p className="text-[12px] leading-5 text-muted">{check.evidence}</p>
        {check.output != null && !check.running ? (
          <>
            {check.state === "pending" ? <p className="text-[11px] text-faint">Output from the previous run:</p> : null}
            <pre
              className={`max-h-52 overflow-auto whitespace-pre-wrap border border-line bg-bg px-2 py-1.5 font-mono text-[11px] leading-5 ${check.state === "pending" ? "text-faint" : "text-text"}`}
            >
              {check.output.trim() || "(no output)"}
            </pre>
          </>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-faint">{formatClock(check.timestamp)}</span>
          <Button variant="quiet" disabled={busy || check.running} onClick={() => void runCheck(taskId)}>
            {check.timestamp ? "Run again" : "Run check"}
          </Button>
        </div>
      </div>
    </li>
  );
}
