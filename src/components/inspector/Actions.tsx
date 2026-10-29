import { useState } from "react";
import { formatAgent } from "../../model/format";
import { waitingOn } from "../../model/selectors";
import { AGENTS } from "../../model/workspace";
import { instructTask, markComplete, runLabel, runTask, stopTask, workspacePath } from "../../runner/live";
import { useShepherd } from "../../store";
import { Button, Field, Select, TextInput } from "../ui";
import { useSelectedTask } from "./useSelectedTask";

export function Actions() {
  const task = useSelectedTask();
  const dispatch = useShepherd((store) => store.dispatch);
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const project = useShepherd((store) => store.state.projects.find((item) => item.id === task.projectId));
  const [note, setNote] = useState("");
  const waiting = task.status === "running" ? null : waitingOn(task, tasks, deps);
  const human = task.runner === "human";
  const folder = [workspacePath() || ".agent-sandbox", project?.directory, task.worktree].filter(Boolean).join("/");

  return (
    <div className="space-y-4">
      {waiting ? (
        <p className="border border-blocked/30 bg-blocked/10 px-2 py-1.5 text-[12px] leading-5 text-blocked">
          Can't {human ? "complete" : "start"} yet. {waiting}.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {human ? (
          <Button variant="primary" disabled={!!waiting || task.status === "completed"} onClick={() => void markComplete(task.id)}>
            Mark complete
          </Button>
        ) : (
          <>
            {task.status === "running" ? (
              <Button variant="ghost" onClick={() => void stopTask(task.id, "blocked")}>
                Pause
              </Button>
            ) : (
              <Button variant="primary" disabled={!!waiting} onClick={() => void runTask(task.id)}>
                {runLabel(task)}
              </Button>
            )}
            {task.status !== "queued" ? (
              <Button variant="ghost" onClick={() => void stopTask(task.id, "queued")}>
                Cancel
              </Button>
            ) : null}
          </>
        )}
      </div>
      <p className="text-[11px] leading-5 text-faint">
        {human
          ? "You do this one. When it is done, mark it complete. That opens anything waiting on it."
          : `Runs the assigned agent in ${folder}. When it finishes, review its files on the Verification tab.`}
      </p>
      {human ? null : (
        <Field label="Agent">
          <Select value={task.agentId ?? ""} onChange={(event) => dispatch({ type: "reassign", id: task.id, agentId: event.target.value || null })}>
            <option value="">Unassigned</option>
            {AGENTS.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {formatAgent(agent)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {human ? null : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!note.trim()) return;
            void instructTask(task.id, note);
            setNote("");
          }}
        >
          <Field label="Instruction">
            <TextInput value={note} placeholder="Tell the agent what to change" onChange={(event) => setNote(event.target.value)} />
          </Field>
          <p className="mt-1 text-[11px] leading-5 text-faint">
            {task.sessionId && task.status !== "running"
              ? "Sending resumes the agent's last session with this instruction."
              : "Saved for the next run."}
          </p>
          <Button className="mt-2" variant="primary" type="submit" disabled={!note.trim()}>
            Send instruction
          </Button>
        </form>
      )}
    </div>
  );
}
