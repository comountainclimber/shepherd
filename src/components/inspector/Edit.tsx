import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { formatAgent } from "../../model/format";
import { hasCycle, incoming } from "../../model/selectors";
import { AGENTS } from "../../model/workspace";
import { useShepherd } from "../../store";
import { Button, Field, GateSelect, Select, TextArea, TextInput } from "../ui";
import { useSelectedTask } from "./useSelectedTask";

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function Edit() {
  const task = useSelectedTask();
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const dispatch = useShepherd((store) => store.dispatch);
  const project = useShepherd((store) => store.state.projects.find((item) => item.id === task.projectId));
  const savedAcceptance = task.acceptance.join("\n");
  const [name, setName] = useState(task.name);
  const [objective, setObjective] = useState(task.objective);
  const [description, setDescription] = useState(task.description);
  const [acceptance, setAcceptance] = useState(savedAcceptance);
  const [checkCommand, setCheckCommand] = useState(task.checkCommand ?? "");
  const [dependency, setDependency] = useState("");

  useEffect(() => {
    setName(task.name);
    setObjective(task.objective);
    setDescription(task.description);
    setAcceptance(savedAcceptance);
    setCheckCommand(task.checkCommand ?? "");
  }, [task.id, task.name, task.objective, task.description, savedAcceptance, task.checkCommand]);

  const agent = task.runner === "agent";
  const projectTasks = tasks.filter((item) => item.projectId === task.projectId && item.id !== task.id);
  const upstream = incoming(task.id, deps);

  return (
    <div className="space-y-4 pb-2">
      <Field label="Name">
        <TextInput
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          onBlur={() => {
            if (name.trim() && name !== task.name) dispatch({ type: "updateTask", id: task.id, patch: { name: name.trim() } });
          }}
        />
      </Field>
      {agent ? (
        <Field label="Agent">
          <Select value={task.agentId ?? ""} onChange={(event) => dispatch({ type: "reassign", id: task.id, agentId: event.target.value || null })}>
            <option value="">Nobody yet</option>
            {AGENTS.map((item) => (
              <option key={item.id} value={item.id}>
                {formatAgent(item)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Goal">
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
      <p className="-mt-3 text-[11px] leading-5 text-faint">The agent reads these. The check below is what actually proves them.</p>
      <Field label="Check">
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
        Shepherd runs this in {task.git ? `the ${task.git.branch} worktree` : agent ? "the task's worktree" : `${project?.directory ?? "the project"}/`} after
        the work. Exit 0 passes.
        {agent && !task.verification.some((check) => check.kind === "review") ? " Nobody reviews this task, so the check alone verifies it." : ""}
      </p>
      {agent ? (
        <div className="space-y-2 text-[13px]">
          <Toggle
            checked={!!task.autoRun}
            onChange={(autoRun) => dispatch({ type: "updateTask", id: task.id, patch: { autoRun } })}
            label="Starts by itself"
            hint="The first time everything it needs clears. Shepherd retries a failed check twice."
          />
          <Toggle
            checked={!!task.independent}
            onChange={(independent) => dispatch({ type: "updateTask", id: task.id, patch: { independent } })}
            label="Judges independently"
            hint="It sees the earlier tasks' files, not what those agents said about them."
          />
        </div>
      ) : null}
      <section>
        <div className="mb-1.5 text-[12px] font-medium text-muted">Needs</div>
        <ul className="space-y-1">
          {upstream.map((dep) => {
            const source = tasks.find((item) => item.id === dep.source);
            return (
              <li key={dep.id} className="flex items-center gap-2 rounded-lg bg-black/20 px-2 py-1 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{source?.name ?? dep.source}</span>
                <GateSelect value={dep.gate} onChange={(gate) => dispatch({ type: "connect", source: dep.source, target: task.id, gate })} />
                <button
                  type="button"
                  aria-label="Remove"
                  className="rounded-lg p-1 text-faint hover:bg-failed/15 hover:text-failed"
                  onClick={() => dispatch({ type: "disconnect", id: dep.id })}
                >
                  <X size={14} />
                </button>
              </li>
            );
          })}
          {!upstream.length ? <li className="text-[12px] text-faint">Nothing. It can start right away.</li> : null}
        </ul>
        <div className="mt-2 flex gap-2">
          <Select value={dependency} onChange={(event) => setDependency(event.target.value)}>
            <option value="">Add a task it needs</option>
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
      <div className="border-t border-line pt-3">
        <Button
          variant="quiet"
          className="text-failed hover:bg-failed/10"
          onClick={() => {
            if (window.confirm(`Delete “${task.name}”? Its branch stays in git.`)) dispatch({ type: "deleteTask", id: task.id });
          }}
        >
          <Trash2 size={14} /> Delete this task
        </Button>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (value: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-black/20 px-3 py-2">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span
        aria-hidden
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-surface-3 transition-colors peer-checked:bg-completed peer-focus-visible:ring-2 peer-focus-visible:ring-brass after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4"
      />
      <span>
        <span className="block font-medium text-text">{label}</span>
        <span className="block text-[11px] leading-5 text-faint">{hint}</span>
      </span>
    </label>
  );
}
