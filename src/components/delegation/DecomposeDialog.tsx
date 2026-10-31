import { useEffect, useMemo, useState } from "react";
import { proposeDecomposition } from "../../model/decompose";
import { blankTask, commandCheck } from "../../model/factory";
import { hasCycle } from "../../model/selectors";
import type { Gate, Task } from "../../model/types";
import { AGENTS } from "../../model/workspace";
import { useShepherd } from "../../store";
import { Button, Dialog, Field, GateSelect, Select, TextArea, TextInput } from "../ui";

interface Draft {
  task: Task;
  gates: Record<string, Gate>;
  checkCommand: string;
}

function withCheck(draft: Draft): Task {
  const command = draft.checkCommand.trim();
  if (!command) return draft.task;
  return {
    ...draft.task,
    checkCommand: command,
    verification: [commandCheck(draft.task.id, command), ...draft.task.verification.filter((check) => check.kind !== "command")],
  };
}

export function DecomposeDialog() {
  const open = useShepherd((store) => store.ui.decomposeOpen);
  const seedText = useShepherd((store) => store.ui.decomposeSeed);
  const projectId = useShepherd((store) => store.ui.projectId);
  const selectedTaskId = useShepherd((store) => store.ui.selectedTaskId);
  const tasks = useShepherd((store) => store.state.tasks);
  const dependencies = useShepherd((store) => store.state.dependencies);
  const seq = useShepherd((store) => store.state.seq);
  const dispatch = useShepherd((store) => store.dispatch);
  const setOpen = useShepherd((store) => store.setDecomposeOpen);
  const selectTask = useShepherd((store) => store.selectTask);
  const requestFit = useShepherd((store) => store.requestFit);

  const [text, setText] = useState(seedText);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setText(seedText);
    setDrafts(null);
    setError("");
  }, [open, seedText]);

  const projectTasks = tasks.filter((task) => task.projectId === projectId);
  const codexId = AGENTS.find((agent) => agent.provider === "codex")?.id ?? null;

  const propose = () => {
    const root = projectTasks.some((task) => task.id === selectedTaskId) ? selectedTaskId : null;
    const originX = projectTasks.length ? Math.max(...projectTasks.map((task) => task.position.x)) + 300 : 24;
    const proposal = proposeDecomposition(text, {
      projectId,
      rootTaskId: root,
      originX,
      nonce: seq + 1,
      agentIds: codexId ? [codexId] : AGENTS.map((agent) => agent.id),
      takenWorktrees: projectTasks.map((task) => task.worktree),
    });
    setDrafts(
      proposal.tasks.map((task) => ({
        task,
        gates: Object.fromEntries(
          proposal.dependencies.filter((dep) => dep.target === task.id).map((dep) => [dep.source, dep.gate]),
        ),
        checkCommand: "",
      })),
    );
    setError("");
  };

  const columns = useMemo(() => {
    if (!drafts) return [];
    const grouped = new Map<number, Draft[]>();
    for (const draft of drafts) {
      const index = columnOf(draft, drafts);
      grouped.set(index, [...(grouped.get(index) ?? []), draft]);
    }
    return [...grouped.entries()].sort((a, b) => a[0] - b[0]);
  }, [drafts]);

  const close = () => {
    setOpen(false);
    setDrafts(null);
  };

  return (
    <Dialog
      open={open}
      wide
      title="Decompose task"
      subtitle="Investigate, implement, then verify. Edit the steps and their gates, then approve them onto the canvas."
      onClose={close}
      footer={
        <>
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          {drafts ? (
            <Button variant="ghost" onClick={() => setDrafts(null)}>
              Edit prompt
            </Button>
          ) : null}
          {drafts ? (
            <Button
              variant="primary"
              disabled={!drafts.length}
              onClick={() => {
                if (!drafts) return;
                const created = drafts.flatMap((draft) =>
                  Object.entries(draft.gates)
                    .filter(([source]) => source !== draft.task.id)
                    .map(([source, gate]) => ({
                      id: `${source}->${draft.task.id}`,
                      source,
                      target: draft.task.id,
                      gate,
                    })),
                );
                const graph = [
                  ...dependencies.filter((dep) => !drafts.some((draft) => draft.task.id === dep.source || draft.task.id === dep.target)),
                  ...created,
                ];
                if (hasCycle(graph)) {
                  setError("Those dependencies form a cycle.");
                  return;
                }
                dispatch({ type: "approvePlan", tasks: drafts.map(withCheck), dependencies: created });
                const first = drafts[0];
                if (first) selectTask(first.task.id);
                requestFit();
                close();
              }}
            >
              Approve plan
            </Button>
          ) : (
            <Button variant="primary" disabled={!text.trim()} onClick={propose}>
              Propose breakdown
            </Button>
          )}
        </>
      }
    >
      {!drafts ? (
        <Field label="Objective">
          <TextArea value={text} onChange={(event) => setText(event.target.value)} />
        </Field>
      ) : (
        <div className="space-y-3">
          {error ? <p className="text-[12px] text-failed">{error}</p> : null}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {columns.map(([index, column]) => (
              <div key={index} className="w-48 shrink-0 space-y-2">
                {column.map((draft) => (
                  <div key={draft.task.id} className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5">
                    <div className="truncate text-[12px] text-text">{draft.task.name}</div>
                    <div className="truncate font-mono text-[10px] text-faint">
                      {AGENTS.find((agent) => agent.id === draft.task.agentId)?.name ?? "Unassigned"}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="space-y-3">
            {drafts.map((draft) => (
              <div key={draft.task.id} className="rounded-lg border border-line bg-black/15 px-3 py-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Name">
                    <TextInput
                      value={draft.task.name}
                      onChange={(event) => updateDraft(setDrafts, draft.task.id, { name: event.target.value })}
                    />
                  </Field>
                  <Field label="Agent">
                    <Select
                      value={draft.task.agentId ?? ""}
                      onChange={(event) => updateDraft(setDrafts, draft.task.id, { agentId: event.target.value || null })}
                    >
                      <option value="">Unassigned</option>
                      {AGENTS.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <div className="mt-2">
                  <Field label="Objective">
                    <TextInput
                      value={draft.task.objective}
                      onChange={(event) => updateDraft(setDrafts, draft.task.id, { objective: event.target.value })}
                    />
                  </Field>
                </div>
                <div className="mt-2">
                  <Field label="Check command (optional)">
                    <TextInput
                      value={draft.checkCommand}
                      placeholder="npm test"
                      className="font-mono"
                      onChange={(event) =>
                        setDrafts(
                          (current) =>
                            current?.map((item) =>
                              item.task.id === draft.task.id ? { ...item, checkCommand: event.target.value } : item,
                            ) ?? null,
                        )
                      }
                    />
                  </Field>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="danger"
                    onClick={() =>
                      setDrafts((current) =>
                        current
                          ?.filter((item) => item.task.id !== draft.task.id)
                          .map((item) => ({
                            ...item,
                            gates: Object.fromEntries(Object.entries(item.gates).filter(([id]) => id !== draft.task.id)),
                          })) ?? null,
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {[...projectTasks, ...drafts.map((item) => item.task)]
                    .filter((item, index, all) => item.id !== draft.task.id && all.findIndex((other) => other.id === item.id) === index)
                    .map((item) => {
                      const gate = draft.gates[item.id];
                      const setGate = (next: Gate | null) =>
                        setDrafts((current) =>
                          current?.map((itemDraft) => {
                            if (itemDraft.task.id !== draft.task.id) return itemDraft;
                            const gates = { ...itemDraft.gates };
                            if (next) gates[item.id] = next;
                            else delete gates[item.id];
                            return { ...itemDraft, gates };
                          }) ?? null,
                        );
                      return (
                        <span key={item.id} className="flex items-center gap-1.5 text-[11px] text-muted">
                          <label className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              className="accent-[#ffc93c]"
                              checked={!!gate}
                              onChange={() => setGate(gate ? null : "verified")}
                            />
                            <span className="max-w-40 truncate">{item.name}</span>
                          </label>
                          {gate ? <GateSelect value={gate} onChange={setGate} /> : null}
                        </span>
                      );
                    })}
                </div>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            onClick={() =>
              setDrafts((current) => {
                if (!current) return current;
                const id = `task-user-${seq + 1}-${current.length}`;
                const task = blankTask({
                  id,
                  projectId,
                  name: "New subtask",
                  objective: text,
                  agentId: codexId,
                  worktree: `subtask-${seq + 1}-${current.length}`,
                  position: { x: (current.at(-1)?.task.position.x ?? 0) + 300, y: 24 },
                });
                return [...current, { task, gates: {}, checkCommand: "" }];
              })
            }
          >
            Add subtask
          </Button>
        </div>
      )}
    </Dialog>
  );
}

function updateDraft(setDrafts: (value: Draft[] | null | ((current: Draft[] | null) => Draft[] | null)) => void, id: string, patch: Partial<Task>) {
  setDrafts((current) => current?.map((draft) => (draft.task.id === id ? { ...draft, task: { ...draft.task, ...patch } } : draft)) ?? null);
}

function columnOf(draft: Draft, drafts: Draft[], seen = new Set<string>()): number {
  if (seen.has(draft.task.id)) return 0;
  const nextSeen = new Set(seen);
  nextSeen.add(draft.task.id);
  const parents = Object.keys(draft.gates)
    .map((id) => drafts.find((item) => item.task.id === id))
    .filter((item): item is Draft => !!item);
  if (!parents.length) return 0;
  return 1 + Math.max(...parents.map((parent) => columnOf(parent, drafts, nextSeen)));
}
