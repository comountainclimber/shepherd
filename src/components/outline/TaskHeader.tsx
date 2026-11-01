import { Check, Copy, FolderOpen, GitBranch, GitMerge, MoreHorizontal, Plus, Terminal } from "lucide-react";
import { useState } from "react";
import { goalSummary } from "../../model/goals";
import { mergePlan, openTaskFolder } from "../../runner/live";
import { useShepherd } from "../../store";
import { Button, Dialog, Field, TextArea, TextInput } from "../ui";

export function TaskHeader() {
  const { state, ui, dispatch, setNewTaskProject, setProblem } = useShepherd();
  const task = state.goals.find((goal) => goal.id === ui.goalId);
  const [dialog, setDialog] = useState<"edit" | "delete" | "merge" | "actions" | null>(null);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!task)
    return (
      <div className="border-b border-line bg-surface px-4 py-3">
        <Button size="sm" onClick={() => setNewTaskProject(ui.projectId)}>
          <Plus size={14} />
          New task
        </Button>
      </div>
    );
  const summary = goalSummary(state, task);
  const mergeable = !!task.branch && !!task.base && summary.complete && !summary.running && !task.blocker;
  const edit = () => {
    setName(task.name);
    setGoal(task.goal);
    setDialog("edit");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(task.folder!);
      setCopied(true);
    } catch {
      setProblem("Could not copy the folder path. Select the path and copy it.");
    }
  };
  const launch = async (app: "cursor" | "finder") => {
    setBusy(true);
    await openTaskFolder(task.id, app);
    setBusy(false);
  };
  return (
    <section aria-label="Selected task" className="shrink-0 border-b border-line bg-surface px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="break-words text-[16px] font-semibold">{task.name}</h1>
            <span className="text-[11px] text-muted">
              {task.status === "open" ? `${summary.done}/${summary.total} steps done` : task.status === "done" ? "Done" : "Archived"}
            </span>
            {task.status === "open" && summary.running ? <span className="text-[11px] text-running">Running</span> : null}
            {task.status === "open" && summary.needsYou ? <span className="text-[11px] text-approval">Needs you</span> : null}
          </div>
          {task.goal ? (
            <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted" title={task.goal}>
              {task.goal}
            </p>
          ) : null}
        </div>
        <Button size="sm" variant="quiet" aria-label="Task actions" title="Task actions" onClick={() => setDialog("actions")}>
          <MoreHorizontal size={17} />
        </Button>
        <Button size="sm" onClick={() => setNewTaskProject(task.projectId)}>
          <Plus size={13} />
          New task
        </Button>
      </div>
      {task.branch ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
          <span className="inline-flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]">
            <GitBranch size={13} className="shrink-0" />
            {task.branch}
          </span>
          <span className="[overflow-wrap:anywhere]">Base: {task.base ?? "—"}</span>
          {task.merged ? <span className="text-completed">Merged into {task.merged.into}</span> : null}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-faint">Branch and folder are made when the first step needs them.</p>
      )}
      {task.folder ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
          <code title={task.folder}
            className="mr-1 min-w-0 basis-full select-text break-all text-[11px] text-faint sm:basis-0 sm:flex-1 sm:truncate">
            {task.folder}
          </code>
          <Button size="sm" variant="quiet" title="Copy folder path" aria-label="Copy folder path" onClick={() => void copy()}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy path"}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void launch("cursor")}>
            <Terminal size={13} />
            Cursor
          </Button>
          <Button size="sm" variant="quiet" disabled={busy} onClick={() => void launch("finder")}>
            <FolderOpen size={13} />
            Finder
          </Button>
        </div>
      ) : null}
      {task.blocker ? (
        <p
          role="status"
          className="mt-2 rounded-lg border border-approval/20 bg-approval/5 px-3 py-2 text-[12px] leading-5 text-approval [overflow-wrap:anywhere]"
        >
          {task.blocker}
        </p>
      ) : null}
      <Dialog open={dialog === "actions"} title="Task actions" subtitle={task.name} onClose={() => setDialog(null)}>
        <div className="flex flex-col items-stretch gap-2">
          <Button onClick={edit}>Edit name and goal</Button>
          {task.status === "open" ? (
            <Button
              onClick={() => {
                dispatch({ type: "finishGoal", id: task.id });
                setDialog(null);
              }}
            >
              Mark task done
            </Button>
          ) : (
            <Button
              onClick={() => {
                dispatch({ type: "reopenGoal", id: task.id });
                setDialog(null);
              }}
            >
              Reopen task
            </Button>
          )}
          {task.status !== "archived" ? (
            <Button
              onClick={() => {
                dispatch({ type: "archiveGoal", id: task.id });
                setDialog(null);
              }}
            >
              Archive task
            </Button>
          ) : null}
          <Button disabled={!mergeable} onClick={() => setDialog("merge")}>
            <GitMerge size={14} />
            Merge into {task.base ?? "base"}
          </Button>
          {!mergeable ? (
            <p className="text-[11px] leading-5 text-faint">
              Merging needs a task branch, all steps done with their checks passed, and no pending work to collect.
            </p>
          ) : null}
          <Button variant="quiet" className="text-failed" onClick={() => setDialog("delete")}>
            Delete task…
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={dialog === "edit"}
        title="Edit task"
        onClose={() => setDialog(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              onClick={() => {
                dispatch({ type: "updateGoal", id: task.id, patch: { name, goal } });
                setDialog(null);
              }}
            >
              Save task
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">
            <TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Goal">
            <TextArea value={goal} onChange={(event) => setGoal(event.target.value)} />
          </Field>
        </div>
      </Dialog>
      <Dialog
        open={dialog === "delete"}
        title="Delete task?"
        onClose={() => setDialog(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                dispatch({ type: "deleteGoal", id: task.id });
                setDialog(null);
              }}
            >
              Delete task
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-6 text-muted">
          Remove “{task.name}” and its steps from the board and stop its agents. This cannot be undone.
        </p>
        <p className="mt-3 break-words text-[13px] leading-6 text-muted">
          {task.branch ? (
            <>
              The branch <code className="break-all text-text">{task.branch}</code> and its folder stay on disk, along with the step
              branches and folders. Your files and commits are kept.
            </>
          ) : (
            "Any existing step branches and folders stay on disk. Your files and commits are kept."
          )}
        </p>
      </Dialog>
      <Dialog
        open={dialog === "merge"}
        title={`Merge into ${task.base}?`}
        onClose={() => !busy && setDialog(null)}
        footer={
          <>
            <Button variant="quiet" disabled={busy} onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || !mergeable}
              onClick={async () => {
                setBusy(true);
                const error = await mergePlan(task.id);
                setBusy(false);
                if (!error) setDialog(null);
              }}
            >
              {busy ? "Merging…" : "Merge task"}
            </Button>
          </>
        }
      >
        <p className="break-words text-[13px] leading-6 text-muted">
          Merge <code className="break-all text-text">{task.branch}</code> into <code className="text-text">{task.base}</code> in the
          project's checkout. This updates the project files.
        </p>
      </Dialog>
    </section>
  );
}
