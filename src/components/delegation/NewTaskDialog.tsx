import { useEffect, useState } from "react";
import { blankGoal } from "../../model/factory";
import { useShepherd } from "../../store";
import { Button, Dialog, Field, TextArea, TextInput } from "../ui";

export function NewTaskDialog() {
  const { ui, state, dispatch, setGoal, setNewTaskProject } = useShepherd();
  const [name, setName] = useState("");
  const [goal, setGoalText] = useState("");
  const project = state.projects.find((project) => project.id === ui.newTaskProjectId);
  useEffect(() => {
    setName("");
    setGoalText("");
  }, [ui.newTaskProjectId]);
  const close = () => setNewTaskProject(null);
  const create = () => {
    if (!project || !name.trim() || !goal.trim()) return;
    const task = blankGoal(project.id, name.trim(), `goal-${crypto.randomUUID()}`, goal.trim());
    dispatch({ type: "createGoal", goal: task });
    setGoal(task.id);
    useShepherd.getState().setView("canvas");
    close();
  };
  return (
    <Dialog
      open={!!project}
      title="New task"
      subtitle={`In ${project?.name ?? "this project"}`}
      onClose={close}
      footer={
        <>
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || !goal.trim()} onClick={create}>
            Create task
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <Field label="Name">
          <TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Fix the checkout timeout" />
        </Field>
        <Field label="Goal">
          <TextArea value={goal} onChange={(event) => setGoalText(event.target.value)} placeholder="What do you want done?" />
        </Field>
        <p className="text-[12px] leading-5 text-muted">
          Next, draft steps from this goal with Codex, choosing Model and Thinking, or write the steps yourself.
        </p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
