import { Check, ExternalLink, FileText, GitMerge, Image as ImageIcon, LoaderCircle, Send, Undo2, X } from "lucide-react";
import { useState } from "react";
import { cx, formatClock, formatDuration } from "../../model/format";
import { failedCheck } from "../../model/stage";
import type { Task, VerificationCheck } from "../../model/types";
import { isFullyVerified } from "../../model/verify";
import { evidenceUrl, forwardFailure, mergeTask, runCheck } from "../../runner/live";
import { useShepherd } from "../../store";
import { Button, Card, Select } from "../ui";
import { useSelectedTask } from "./useSelectedTask";

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

function verdict(task: Task, verified: boolean): { tone: string; text: string } {
  const reviewed = task.verification.some((check) => check.kind === "review");
  if (verified) {
    if (task.runner === "human") return { tone: "completed", text: "You signed this off." };
    return { tone: "completed", text: reviewed ? "Its check passed and you accepted it." : "Its check passed. That is what verifies it." };
  }
  if (task.runner === "human") return { tone: "approval", text: "This one is yours. Mark it done when it is. Your sign-off is the proof." };
  if (task.status === "running") return { tone: "running", text: "The agent is working. Its proof shows up here when it finishes." };
  if (failedCheck(task)) return { tone: "failed", text: "Shepherd's check failed. Here is exactly what it found." };
  if (task.status === "failed") return { tone: "failed", text: "This run failed or you sent it back. Try again from the top, with an instruction on the Log tab if it needs one." };
  if (task.status === "completed") {
    return {
      tone: "approval",
      text: reviewed ? "The agent says it is done. That doesn't count until the proof says so. Read it, then decide." : "The agent says it is done. Its check decides.",
    };
  }
  return { tone: "queued", text: "No proof yet. It appears after the task runs." };
}

const VERDICT_TONE: Record<string, string> = {
  completed: "border-completed/50 bg-completed/10 text-completed",
  approval: "border-approval/50 bg-approval/10 text-approval",
  running: "border-running/50 bg-running/10 text-running",
  failed: "border-failed/50 bg-failed/10 text-failed",
  queued: "border-line bg-black/20 text-muted",
};

export function Verification() {
  const task = useSelectedTask();
  const verified = isFullyVerified(task);
  const note = verdict(task, verified);

  return (
    <div className="space-y-3">
      <p className={cx("rounded-lg border px-3 py-2 text-[13px] font-medium leading-5", VERDICT_TONE[note.tone])}>{note.text}</p>
      {task.verification.map((check) =>
        check.kind === "command" ? (
          <CheckCard key={check.id} check={check} task={task} />
        ) : (
          <ReviewCard key={check.id} check={check} task={task} />
        ),
      )}
      {failedCheck(task) ? <SendFailure task={task} /> : null}
      <Changes task={task} />
      {task.git && task.runner === "agent" ? <Merge key={task.id} task={task} verified={verified} /> : null}
    </div>
  );
}

function StateChip({ check }: { check: VerificationCheck }) {
  const label = check.running ? "Running" : check.state === "passed" ? "Passed" : check.state === "failed" ? "Failed" : "Waiting";
  const tone = check.running
    ? "bg-checking/15 text-checking"
    : check.state === "passed"
      ? "bg-completed/15 text-completed"
      : check.state === "failed"
        ? "bg-failed/15 text-failed"
        : "bg-white/5 text-faint";
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-px text-[11px] font-medium", tone)}>
      {check.running ? <LoaderCircle size={11} className="animate-spin" /> : null}
      {label}
    </span>
  );
}

function CheckCard({ check, task }: { check: VerificationCheck; task: Task }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const files = check.artifacts ?? [];
  const shots = files.filter((file) => IMAGE.test(file));
  const others = files.filter((file) => !IMAGE.test(file));
  const passed = check.steps?.filter((step) => step.ok).length ?? 0;

  return (
    <Card
      title="Shepherd's check"
      right={
        <div className="flex items-center gap-1.5">
          <StateChip check={check} />
          <Button variant="quiet" size="sm" disabled={task.status === "running" || check.running} onClick={() => void runCheck(task.id)}>
            {check.timestamp ? "Run again" : "Run it"}
          </Button>
        </div>
      }
    >
      <code className="block truncate rounded-lg bg-black/30 px-2 py-1 font-mono text-[11px] text-brass" title={check.command}>
        $ {check.command}
      </code>
      {!check.steps?.length ? <p className="mt-2 text-[13px] leading-5 text-muted">{check.evidence}</p> : null}
      {check.steps?.length ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-muted">
            <span>Steps</span>
            <span className="font-mono text-[13px]">
              {passed}/{check.steps.length}
            </span>
          </div>
          <ul className="space-y-1">
            {check.steps.map((step, index) => (
              <li key={index} className={cx("flex gap-2 rounded-lg px-2 py-1.5", step.ok ? "bg-black/15" : "bg-failed/10")}>
                <span
                  className={cx(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                    step.ok ? "bg-completed text-emerald-950" : "bg-failed text-rose-950",
                  )}
                >
                  {step.ok ? <Check size={12} strokeWidth={3.5} /> : <X size={12} strokeWidth={3.5} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-text">{step.name}</span>
                  {step.detail ? <span className="block break-words text-[12px] leading-5 text-muted">{step.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {shots.length ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-muted">
            <ImageIcon size={13} /> Screenshots
          </div>
          <div className="grid grid-cols-2 gap-2">
            {shots.map((file) => (
              <button
                key={file}
                type="button"
                onClick={() => setZoom(file)}
                className="group overflow-hidden rounded-lg border border-line bg-black/30 text-left hover:border-brass"
              >
                <img src={evidenceUrl(task.id, file)} alt={file} loading="lazy" className="aspect-video w-full object-cover object-top" />
                <span className="block truncate px-2 py-1 text-[11px] text-muted group-hover:text-text">{shotName(file)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {others.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {others.map((file) => (
            <a
              key={file}
              href={evidenceUrl(task.id, file)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 text-[12px] text-text hover:bg-surface-2"
            >
              <FileText size={12} /> {artifactLabel(file)} <ExternalLink size={11} className="text-faint" />
            </a>
          ))}
        </div>
      ) : null}
      {check.output != null && !check.running ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] font-medium text-muted hover:text-text">
            {check.state === "pending" ? "Output from the last run" : "Full output"}
            {check.durationMs ? ` · took ${formatDuration(check.durationMs)}` : ""}
          </summary>
          <pre className="mt-1.5 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-black/35 px-2.5 py-2 font-mono text-[11px] leading-5 text-text">
            {check.output.trim() || "(no output)"}
          </pre>
        </details>
      ) : null}
      {check.timestamp ? <div className="mt-2 text-[11px] text-faint">Ran at {formatClock(check.timestamp)}</div> : null}
      {zoom ? (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-black/80 p-8" onMouseDown={() => setZoom(null)}>
          <img
            src={evidenceUrl(task.id, zoom)}
            alt={zoom}
            className="max-h-[80vh] max-w-full rounded-lg border-4 border-line-strong"
            onMouseDown={(event) => event.stopPropagation()}
          />
          <div className="flex items-center gap-3 text-[13px] text-muted">
            <span>{shotName(zoom)}</span>
            <a href={evidenceUrl(task.id, zoom)} target="_blank" rel="noreferrer" className="font-medium text-brass hover:underline" onMouseDown={(event) => event.stopPropagation()}>
              Open full size
            </a>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function shotName(file: string): string {
  return (file.split("/").pop() ?? file).replace(IMAGE, "").replace(/[-_]+/g, " ");
}

function artifactLabel(file: string): string {
  if (/(^|\/)playwright-report\/index\.html$/.test(file)) return "Browser test report";
  if (/(^|\/)coverage\/index\.html$/.test(file)) return "Coverage report";
  if (/index\.html$/.test(file)) return `${file.split("/").slice(-2, -1)[0] ?? "HTML"} report`;
  if (file.endsWith("trace.zip")) return "Browser trace";
  return file.split("/").pop() ?? file;
}

function ReviewCard({ check, task }: { check: VerificationCheck; task: Task }) {
  const dispatch = useShepherd((store) => store.dispatch);
  const reviewable = task.status === "completed";
  return (
    <Card title="Your review" right={<StateChip check={check} />}>
      <p className="text-[13px] leading-5 text-muted">
        {check.state === "pending" && reviewable ? "Look at what it changed below. Accept it if it does the job." : check.evidence}
      </p>
      {reviewable ? (
        <div className="mt-2.5 flex gap-2">
          <Button
            variant="go"
            disabled={check.state === "passed"}
            onClick={() => dispatch({ type: "setCheck", taskId: task.id, checkId: check.id, state: "passed" })}
          >
            <Check size={15} strokeWidth={3} /> Accept
          </Button>
          <Button
            variant="danger"
            disabled={check.state === "failed"}
            onClick={() => dispatch({ type: "setCheck", taskId: task.id, checkId: check.id, state: "failed" })}
          >
            <Undo2 size={15} strokeWidth={3} /> Send back
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

/** Every agent task upstream of this one, nearest first: the tasks whose fix would reach it. */
function upstreamAgents(task: Task, tasks: Task[], deps: { source: string; target: string }[]): Task[] {
  const seen = new Set<string>();
  const order: Task[] = [];
  for (let queue = [task.id]; queue.length; ) {
    const next = queue.shift()!;
    for (const dep of deps) {
      if (dep.target !== next || seen.has(dep.source)) continue;
      seen.add(dep.source);
      queue.push(dep.source);
      const source = tasks.find((item) => item.id === dep.source);
      if (source?.runner === "agent") order.push(source);
    }
  }
  return order;
}

function SendFailure({ task }: { task: Task }) {
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const options = upstreamAgents(task, tasks, deps);
  const [target, setTarget] = useState(options[0]?.id ?? "");
  const [sent, setSent] = useState<string | null>(null);
  if (!options.length) return null;
  const chosen = options.find((item) => item.id === target) ?? options[0]!;
  return (
    <Card title="Not this task's fault?">
      <p className="text-[13px] leading-5 text-muted">
        Send the failure to the earlier task that owns the problem. It fixes it there, then Shepherd brings the fix forward and checks
        everything after it again.
      </p>
      <div className="mt-2.5 flex gap-2">
        <Select value={chosen.id} onChange={(event) => setTarget(event.target.value)}>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        <Button
          variant="primary"
          onClick={async () => {
            const error = await forwardFailure(task.id, chosen.id);
            setSent(error ? null : chosen.name);
          }}
        >
          <Send size={15} /> Send
        </Button>
      </div>
      {sent ? <p className="mt-2 text-[12px] font-medium text-completed">Sent to {sent}. It is working on the fix.</p> : null}
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
      <p className="mt-2 text-[11px] text-faint">Only this task's own changes. Work merged in from earlier tasks is left out.</p>
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

function Merge({ task, verified }: { task: Task; verified: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const git = task.git!;
  return (
    <Card title="Merge" right={git.merged ? <span className="text-[11px] font-medium uppercase text-completed">Merged</span> : null}>
      <p className="text-[13px] leading-5 text-muted">
        {git.merged
          ? `Merged into ${git.merged.into} as ${git.merged.sha} at ${formatClock(git.merged.at)}.`
          : verified
            ? `Brings ${git.branch} into ${git.target} in the project folder.`
            : `Once it clears, you can merge ${git.branch} into ${git.target}.`}
      </p>
      {error ? <p className="mt-1 text-[12px] leading-5 text-failed">{error}</p> : null}
      {git.merged ? null : (
        <Button
          className="mt-2.5"
          variant="primary"
          disabled={!verified || busy || task.status === "running"}
          onClick={async () => {
            setBusy(true);
            setError(await mergeTask(task.id));
            setBusy(false);
          }}
        >
          <GitMerge size={15} /> {busy ? "Merging…" : `Merge into ${git.target}`}
        </Button>
      )}
    </Card>
  );
}
