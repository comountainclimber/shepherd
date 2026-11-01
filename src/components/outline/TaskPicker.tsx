import { useState } from "react";
import { blankGoal } from "../../model/factory";
import { useShepherd } from "../../store";
import { Button, Dialog, Field, TextArea, TextInput } from "../ui";

/** A temporary picker until tasks have their own view. */
export function TaskPicker() {
  const { state, ui, dispatch, setGoal } = useShepherd();
  const goals = state.goals.filter((goal) => goal.projectId === ui.projectId);
  const selected = goals.find((goal) => goal.id === ui.goalId);
  const [editing, setEditing] = useState<"new" | "edit" | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const open = (mode: "new" | "edit") => {
    setName(mode === "edit" ? selected?.name ?? "" : "");
    setText(mode === "edit" ? selected?.goal ?? "" : "");
    setEditing(mode);
  };
  return (
    <div className="border-b border-line p-3">
      <label htmlFor="task-picker" className="mb-1 block text-[11px] text-muted">Task</label>
      <div className="flex min-w-0 gap-2">
        <select id="task-picker" aria-label="Task" value={ui.goalId} onChange={(event) => setGoal(event.target.value)} className="min-w-0 flex-1 rounded border border-line-strong bg-surface-2 p-2 text-[13px]">
          {!selected ? <option value="">Choose a task</option> : null}
          {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.name}{goal.status === "open" ? "" : ` (${goal.status})`}</option>)}
        </select>
        <Button size="sm" onClick={() => open("new")}>New task</Button>
      </div>
      {selected ? <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="quiet" onClick={() => open("edit")}>Edit task</Button>
        {selected.status === "open" ? <Button size="sm" variant="quiet" onClick={() => dispatch({ type: "finishGoal", id: selected.id })}>Finish task</Button>
          : <Button size="sm" variant="quiet" onClick={() => dispatch({ type: "reopenGoal", id: selected.id })}>Reopen task</Button>}
        {selected.status !== "archived" ? <Button size="sm" variant="quiet" onClick={() => dispatch({ type: "archiveGoal", id: selected.id })}>Archive</Button> : null}
      </div> : null}
      <Dialog open={editing !== null} title={editing === "new" ? "New task" : "Edit task"} onClose={() => setEditing(null)} footer={<>
        <Button variant="quiet" onClick={() => setEditing(null)}>Cancel</Button>
        <Button variant="primary" disabled={!name.trim()} onClick={() => {
          if (editing === "new") {
            const goal = blankGoal(ui.projectId, name.trim(), `goal-${crypto.randomUUID()}`, text.trim());
            dispatch({ type: "createGoal", goal });
            setGoal(goal.id);
          } else if (selected) dispatch({ type: "updateGoal", id: selected.id, patch: { name, goal: text } });
          setEditing(null);
        }}>{editing === "new" ? "Create task" : "Save task"}</Button>
      </>}>
        <div className="space-y-3">
          <Field label="Name"><TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="What is this task?" /></Field>
          <Field label="Goal"><TextArea value={text} onChange={(event) => setText(event.target.value)} placeholder="What do you want done?" /></Field>
        </div>
      </Dialog>
    </div>
  );
}
