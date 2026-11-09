import { useEffect, useState } from "react";
import { create } from "zustand";
import { goalSummary } from "../../model/goals";
import type { Goal, OrchestrationState } from "../../model/types";
import { mergePlan, openTaskFolder } from "../../runner/live";
import { useShepherd } from "../../store";
import { notify } from "../shell/Toasts";
import { Button, Dialog, Field, TextArea, TextInput } from "../ui";

type GraphDialog = { kind: "edit" | "merge" | "delete"; goalId: string };

/** The graph dialog that is open, if any. The graph's ⋯ menu opens these. */
export const useGraphDialog = create<{ dialog: GraphDialog | null; open: (dialog: GraphDialog | null) => void }>()((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
}));

/** A graph merges once it has a branch and every step is done, with nothing running or in the way. */
export function mergeable(state: OrchestrationState, goal: Goal): boolean {
  const summary = goalSummary(state, goal);
  return !!goal.branch && !!goal.base && summary.complete && !summary.running && !goal.blocker;
}

export async function copyFolder(goal: Goal) {
  if (!goal.folder) return;
  try {
    await navigator.clipboard.writeText(goal.folder);
    notify("Copied the folder path", goal.folder);
  } catch {
    useShepherd.getState().setProblem("Could not copy the folder path. Open the folder in Finder instead.");
  }
}

export function openFolder(goal: Goal, app: "cursor" | "finder") {
  void openTaskFolder(goal.id, app);
}

/** Edit, merge and delete for one graph, opened from its ⋯ menu. */
export function GraphDialogs() {
  const dialog = useGraphDialog((store) => store.dialog);
  const open = useGraphDialog((store) => store.open);
  const goal = useShepherd((store) => store.state.goals.find((item) => item.id === dialog?.goalId));
  const state = useShepherd((store) => store.state);
  const dispatch = useShepherd((store) => store.dispatch);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (dialog?.kind !== "edit" || !goal) return;
    setName(goal.name);
    setText(goal.goal);
  }, [dialog, goal?.id]);

  if (!dialog || !goal) return null;
  const close = () => !busy && open(null);

  if (dialog.kind === "edit") {
    return (
      <Dialog
        open
        title="Edit graph"
        onClose={close}
        footer={
          <>
            <Button variant="quiet" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              onClick={() => {
                dispatch({ type: "updateGoal", id: goal.id, patch: { name, goal: text } });
                open(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Name">
            <TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Goal">
            <TextArea value={text} onChange={(event) => setText(event.target.value)} placeholder="What should this graph get done?" />
          </Field>
        </div>
      </Dialog>
    );
  }

  if (dialog.kind === "merge") {
    const ready = mergeable(state, goal);
    return (
      <Dialog
        open
        title={`Merge into ${goal.base ?? "base"}?`}
        onClose={close}
        footer={
          <>
            <Button variant="quiet" disabled={busy} onClick={close}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || !ready}
              onClick={async () => {
                setBusy(true);
                const error = await mergePlan(goal.id);
                setBusy(false);
                if (!error) open(null);
              }}
            >
              {busy ? "Merging…" : "Merge graph"}
            </Button>
          </>
        }
      >
        <p className="break-words text-[13px] leading-6 text-muted">
          Merge <code className="break-all text-text">{goal.branch}</code> into <code className="text-text">{goal.base}</code> in the
          project's checkout. This updates the project files.
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      title="Delete graph?"
      onClose={close}
      footer={
        <>
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const store = useShepherd.getState();
              const focused = store.ui.goalId === goal.id;
              dispatch({ type: "deleteGoal", id: goal.id });
              if (focused && goal.objectiveId) store.setObjective(goal.objectiveId);
              open(null);
            }}
          >
            Delete graph
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-6 text-muted">
        Remove “{goal.name}” and its steps from the board and stop its agents. This cannot be undone.
      </p>
      <p className="mt-3 break-words text-[13px] leading-6 text-muted">
        {goal.branch ? (
          <>
            The branch <code className="break-all text-text">{goal.branch}</code> and its folder stay on disk, along with the step branches
            and folders. Your files and commits are kept.
          </>
        ) : (
          "Any existing step branches and folders stay on disk. Your files and commits are kept."
        )}
      </p>
    </Dialog>
  );
}
