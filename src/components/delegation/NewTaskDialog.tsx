import { useEffect, useState } from "react";
import { blankTask, nextPosition, slugify } from "../../model/factory";
import type { Gate, Runner } from "../../model/types";
import { AGENTS } from "../../model/workspace";
import { useShepherd } from "../../store";
import { Button, Dialog, Field, GateSelect, Select, TextArea, TextInput } from "../ui";

const DEFAULT_AGENT = AGENTS.find((agent) => agent.provider === "codex")?.id ?? "";

export function NewTaskDialog() {
  const open = useShepherd((store) => store.ui.newTaskOpen);
  const projectId = useShepherd((store) => store.ui.projectId);
  const setOpen = useShepherd((store) => store.setNewTaskOpen);
  const projects = useShepherd((store) => store.state.projects);
  const tasks = useShepherd((store) => store.state.tasks);
  const seq = useShepherd((store) => store.state.seq);
  const dispatch = useShepherd((store) => store.dispatch);
  const selectTask = useShepherd((store) => store.selectTask);
  const requestFit = useShepherd((store) => store.requestFit);

  const project = projects.find((item) => item.id === projectId);
  const projectTasks = tasks.filter((task) => task.projectId === projectId);

  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [runner, setRunner] = useState<Runner>("agent");
  const [agentId, setAgentId] = useState(DEFAULT_AGENT);
  const [gates, setGates] = useState<Record<string, Gate>>({});
  const [checkCommand, setCheckCommand] = useState("");

  // Keyed on the project id, not the project object: every shared-state pull replaces the object,
  // which would wipe whatever is being typed.
  useEffect(() => {
    if (!open) return;
    setName("");
    setObjective("");
    setRunner("agent");
    setAgentId(DEFAULT_AGENT);
    setGates({});
    setCheckCommand("");
  }, [open, projectId]);

  const close = () => setOpen(false);
  const dependsOn = Object.keys(gates);

  return (
    <Dialog
      open={open}
      title="New task"
      subtitle="An agent runs it in the project folder, or you do it yourself and sign it off."
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
              const id = `task-user-${seq + 1}`;
              const base = slugify(name);
              const worktree = projectTasks.some((task) => task.worktree === base) ? `${base}-${seq + 1}` : base;
              const task = blankTask({
                id,
                projectId,
                name: name.trim(),
                objective: objective.trim() || name.trim(),
                runner,
                agentId: agentId || null,
                position: nextPosition(tasks, projectId, dependsOn),
                worktree,
                checkCommand,
              });
              dispatch({
                type: "createTask",
                task,
                dependsOn: Object.entries(gates).map(([source, gate]) => ({ source, gate })),
              });
              selectTask(id);
              requestFit();
              close();
            }}
          >
            Add to canvas
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Name the task" />
        </Field>
        <Field label="Objective">
          <TextArea value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="What does done look like?" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Who does it">
            <Select value={runner} onChange={(event) => setRunner(event.target.value as Runner)}>
              <option value="agent">An agent</option>
              <option value="human">Me</option>
            </Select>
          </Field>
          {runner === "agent" ? (
            <Field label="Agent">
              <Select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                <option value="">Unassigned</option>
                {AGENTS.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
        <Field label="Check command (optional)">
          <TextInput
            value={checkCommand}
            onChange={(event) => setCheckCommand(event.target.value)}
            placeholder="npm test"
            className="font-mono"
          />
        </Field>
        <p className="-mt-2 text-[11px] leading-5 text-faint">
          Shepherd runs it in {project?.directory ? `${project.directory}/` : "the project folder"} when the work is done. Exit 0 passes; anything
          else fails the task and its output goes back to the agent.
        </p>
        <fieldset>
          <legend className="mb-1 text-[11px] text-muted">Starts after</legend>
          <div className="max-h-36 space-y-1 overflow-auto">
            {projectTasks.map((task) => {
              const gate = gates[task.id];
              return (
                <div key={task.id} className="flex items-center gap-2 text-[12px]">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-[#c4a574]"
                      checked={!!gate}
                      onChange={() =>
                        setGates((current) => {
                          const next = { ...current };
                          if (next[task.id]) delete next[task.id];
                          else next[task.id] = "verified";
                          return next;
                        })
                      }
                    />
                    <span className="truncate">{task.name}</span>
                  </label>
                  {gate ? (
                    <GateSelect value={gate} onChange={(value) => setGates((current) => ({ ...current, [task.id]: value }))} />
                  ) : null}
                </div>
              );
            })}
            {!projectTasks.length ? <p className="text-[12px] text-faint">This project has no tasks yet.</p> : null}
          </div>
        </fieldset>
      </div>
    </Dialog>
  );
}