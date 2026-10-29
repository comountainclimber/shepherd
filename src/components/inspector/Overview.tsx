import { useEffect, useState } from "react";
import { GATE_LABEL } from "../../model/types";
import { hasCycle, incoming, outgoing } from "../../model/selectors";
import { dependencySatisfied } from "../../model/verify";
import { useShepherd } from "../../store";
import { Button, Field, GateSelect, Select, TextArea, TextInput, statusText } from "../ui";
import { useSelectedTask } from "./useSelectedTask";

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function Overview() {
  const task = useSelectedTask();
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const dispatch = useShepherd((store) => store.dispatch);
  const selectTask = useShepherd((store) => store.selectTask);
  const project = useShepherd((store) => store.state.projects.find((item) => item.id === task.projectId));
  const savedAcceptance = task.acceptance.join("\n");
  const [objective, setObjective] = useState(task.objective);
  const [description, setDescription] = useState(task.description);
  const [acceptance, setAcceptance] = useState(savedAcceptance);
  const [checkCommand, setCheckCommand] = useState(task.checkCommand ?? "");
  const [dependency, setDependency] = useState("");

  useEffect(() => {
    setObjective(task.objective);
    setDescription(task.description);
    setAcceptance(savedAcceptance);
    setCheckCommand(task.checkCommand ?? "");
  }, [task.id, task.objective, task.description, savedAcceptance, task.checkCommand]);

  const projectTasks = tasks.filter((item) => item.projectId === task.projectId && item.id !== task.id);
  const upstream = incoming(task.id, deps);
  const downstream = outgoing(task.id, deps);

  return (
    <div className="space-y-4">
      <Field label="Objective">
        <TextArea
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          onBlur={() => {
            if (objective !== task.objective) dispatch({ type: "updateTask", id: task.id, patch: { objective } });
          }}
        />
      </Field>
      <Field label="Context">
        <TextArea
          value={description}
          placeholder="Anything else the agent should know"
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => {
            if (description !== task.description) dispatch({ type: "updateTask", id: task.id, patch: { description } });
          }}
        />
      </Field>
      <Field label="Done when (one per line)">
        <TextArea
          value={acceptance}
          placeholder="The page loads without errors"
          onChange={(event) => setAcceptance(event.target.value)}
          onBlur={() => {
            const next = lines(acceptance);
            if (next.join("\n") !== savedAcceptance) dispatch({ type: "updateTask", id: task.id, patch: { acceptance: next } });
          }}
        />
      </Field>
      <p className="-mt-3 text-[11px] leading-5 text-faint">The agent gets these with the objective. Shepherd does not check them; the check command does.</p>
      <Field label="Check command">
        <TextInput
          className="font-mono"
          value={checkCommand}
          placeholder="npm test"
          onChange={(event) => setCheckCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          onBlur={() => dispatch({ type: "setCheckCommand", id: task.id, command: checkCommand })}
        />
      </Field>
      <p className="-mt-3 text-[11px] leading-5 text-faint">
        Runs in {project?.directory ? `${project.directory}/` : "the workspace folder"} when the work is done. Exit 0 passes.
      </p>
      {task.blocker ? <p className={`text-[12px] leading-5 ${statusText[task.status]}`}>{task.blocker}</p> : null}
      <section>
        <h3 className="mb-1.5 text-[11px] text-muted">Depends on</h3>
        <ul className="space-y-1">
          {upstream.map((dep) => {
            const source = tasks.find((item) => item.id === dep.source);
            const open = dependencySatisfied(dep, source);
            return (
              <li key={dep.id} className="flex items-center gap-2 text-[12px]">
                <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-brass" onClick={() => selectTask(dep.source)}>
                  {source?.name ?? dep.source}
                </button>
                <GateSelect
                  value={dep.gate}
                  onChange={(gate) => dispatch({ type: "connect", source: dep.source, target: task.id, gate })}
                />
                <span className={`font-mono text-[10px] ${open ? "text-completed" : "text-blocked"}`}>{open ? "open" : "closed"}</span>
                <button
                  type="button"
                  className="text-[11px] text-muted hover:text-failed"
                  onClick={() => dispatch({ type: "disconnect", id: dep.id })}
                >
                  Remove
                </button>
              </li>
            );
          })}
          {!upstream.length ? <li className="text-[12px] text-faint">No upstream tasks.</li> : null}
        </ul>
        <div className="mt-2 flex gap-2">
          <Select value={dependency} onChange={(event) => setDependency(event.target.value)}>
            <option value="">Add a dependency</option>
            {projectTasks
              .filter((item) => !upstream.some((dep) => dep.source === item.id))
              .filter((item) => !hasCycle([...deps, { source: item.id, target: task.id }]))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </Select>
          <Button
            variant="ghost"
            disabled={!dependency}
            onClick={() => {
              dispatch({ type: "connect", source: dependency, target: task.id, gate: "verified" });
              setDependency("");
            }}
          >
            Add
          </Button>
        </div>
      </section>
      <section>
        <h3 className="mb-1.5 text-[11px] text-muted">Downstream</h3>
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
          {!downstream.length ? <li className="text-[12px] text-faint">Nothing is waiting on this.</li> : null}
        </ul>
      </section>
    </div>
  );
}
