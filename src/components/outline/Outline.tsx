import { BookmarkPlus, ChevronRight, GitMerge, GripVertical, LoaderCircle, Play, Plus, Sparkles, Square, Waypoints } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { DEFAULT_AGENT_ID, newStep } from "../../model/factory";
import { cx } from "../../model/format";
import { isEffort, isModelId, modelName, providerOf } from "../../model/models";
import { indent, moveBlock, moveDown, moveUp, outdent, outlineOf, parseList, subtreeEnd } from "../../model/outline";
import { STAGE_LABEL, STEP_LABEL, assigneeFor, needsYou, nextStep, openIssues, progress, stageHint, stageOf } from "../../model/stage";
import type { Effort, OutlineItem, Task } from "../../model/types";
import { AGENTS } from "../../model/workspace";
import { draftSteps, mergePlan, runPlan, stopPlan } from "../../runner/live";
import { useShepherd } from "../../store";
import { ModelPicker } from "../inspector/ModelPicker";
import { placeFor } from "../saved/addSaved";
import { SavedPicker } from "../saved/SavedPicker";
import { useModels } from "../useModels";
import { useNextStep } from "../useNextStep";
import { Avatar, Button, ProgressBar, stageIcon, stageText } from "../ui";
import { appendStep } from "./appendStep";

const NAME_LIMIT = 80;
const INDENT_PX = 20;
const PICKABLE = [...AGENTS].sort((a, b) => (a.provider === "codex" ? -1 : b.provider === "codex" ? 1 : 0));

/** A line too long for a name keeps the whole line as the step's prompt. */
function stepFrom(projectId: string, line: string, prompt: string, agentId: string | null, context = ""): Task {
  let name = line;
  if (line.length > NAME_LIMIT) {
    const cut = line.slice(0, NAME_LIMIT);
    name = `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : NAME_LIMIT)}…`;
  }
  const task = newStep(projectId, name, prompt || (name === line ? "" : line), agentId);
  return context ? { ...task, description: context } : task;
}

function editable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT" || element.isContentEditable);
}

/** The project's steps as an indented list you type into. The map beside it follows it. */
export function Outline() {
  const projectId = useShepherd((store) => store.ui.projectId);
  const state = useShepherd((store) => store.state);
  const selectedTaskId = useShepherd((store) => store.ui.selectedTaskId);
  const addSaved = useShepherd((store) => store.ui.addSaved);
  const setAddSaved = useShepherd((store) => store.setAddSaved);
  const dispatch = useShepherd((store) => store.dispatch);
  const project = state.projects.find((item) => item.id === projectId);
  const items = useMemo(() => outlineOf(state, projectId), [state, projectId]);
  const byId = useMemo(() => new Map(state.tasks.map((task) => [task.id, task])), [state.tasks]);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const [pendingFocus, setPendingFocus] = useState<{ id: string; at: "start" | "end" } | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number | null } | null>(null);
  const latest = useRef({ items, byId });
  latest.current = { items, byId };

  useEffect(() => {
    if (!pendingFocus) return;
    const input = inputs.current.get(pendingFocus.id);
    if (!input) return;
    input.focus();
    const at = pendingFocus.at === "end" ? input.value.length : 0;
    input.setSelectionRange(at, at);
    setPendingFocus(null);
  }, [pendingFocus, items]);

  const save = (next: OutlineItem[] | null) => {
    if (next) dispatch({ type: "setOutline", projectId, items: next });
  };

  const add = (after: string | null, depth: number, from?: Task) => {
    const agentId = from?.runner === "agent" ? from.agentId : DEFAULT_AGENT_ID;
    const task = newStep(projectId, "", "", agentId);
    dispatch({ type: "addSteps", projectId, after, steps: [{ task, depth }] });
    setPendingFocus({ id: task.id, at: "start" });
  };

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "n" || event.metaKey || event.ctrlKey || event.altKey || editable(event.target)) return;
      const { ui } = useShepherd.getState();
      if (ui.paletteOpen || ui.newProjectOpen) return;
      event.preventDefault();
      appendStep(ui.projectId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A blank step picked anywhere else, such as on the map or from ⌘K, gets the cursor so it can be named.
  useEffect(() => {
    const task = selectedTaskId ? latest.current.byId.get(selectedTaskId) : undefined;
    if (task && !task.name && !editable(document.activeElement)) setPendingFocus({ id: task.id, at: "start" });
  }, [selectedTaskId]);

  if (!project) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    const item = items[index]!;
    const task = byId.get(item.id);
    const input = event.currentTarget;
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (input.selectionStart === 0 && input.selectionEnd === 0 && input.value) {
        add(index > 0 ? items[index - 1]!.id : null, item.depth, task);
        return;
      }
      const parent = (items[index + 1]?.depth ?? -1) > item.depth;
      add(item.id, parent ? item.depth + 1 : item.depth, task);
    } else if (event.key === "Tab") {
      event.preventDefault();
      save(event.shiftKey ? outdent(items, index) : indent(items, index));
    } else if (event.key === "Backspace" && !input.value) {
      if (!task || task.git || task.sessionId || task.status !== "queued") return;
      event.preventDefault();
      const neighbour = items[index - 1] ?? items[index + 1];
      dispatch({ type: "deleteTask", id: item.id });
      if (neighbour) setPendingFocus({ id: neighbour.id, at: "end" });
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const up = event.key === "ArrowUp";
      event.preventDefault();
      if (event.altKey) {
        save(up ? moveUp(items, index) : moveDown(items, index));
        return;
      }
      const next = items[index + (up ? -1 : 1)];
      if (next) setPendingFocus({ id: next.id, at: "end" });
    } else if (event.key === "Escape") {
      input.blur();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>, index: number) => {
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\n")) return;
    const lines = parseList(text);
    if (lines.length < 2) return;
    event.preventDefault();
    const item = items[index]!;
    const task = byId.get(item.id);
    if (!task) return;
    const agentId = task.runner === "agent" ? task.agentId : DEFAULT_AGENT_ID;
    const base = item.depth - lines[0]!.depth;
    let rest = lines;
    if (!task.name.trim()) {
      const first = stepFrom(projectId, lines[0]!.name, "", agentId);
      dispatch({ type: "updateTask", id: task.id, patch: { name: first.name, objective: first.objective } });
      rest = lines.slice(1);
    }
    const steps = rest.map((line) => ({ task: stepFrom(projectId, line.name, "", agentId), depth: Math.max(0, base + line.depth) }));
    const after = items[subtreeEnd(items, index) - 1]!.id;
    dispatch({ type: "addSteps", projectId, after, steps });
    const last = steps.at(-1);
    if (last) setPendingFocus({ id: last.task.id, at: "end" });
  };

  const drawnByHand = (task: Task) =>
    !!project.outline && (!!task.wired || state.dependencies.some((dep) => dep.target === task.id && !dep.outline));
  /** The row the saved-step picker opens under: the blank row it replaces, or the row it adds after unless that is the last. */
  const pickerUnder = addSaved ? (addSaved.replace ?? (addSaved.after !== items.at(-1)?.id ? addSaved.after : null)) : null;
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-baseline justify-between px-4 pb-1 pt-3.5">
        <h2 className="text-[13px] font-semibold text-text">Steps</h2>
        {items.length ? <span className="text-[11px] text-faint">Enter adds · Tab runs side by side</span> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {items.length === 0 ? (
          <Start projectId={projectId} onWrite={() => add(null, 0)} />
        ) : (
          <>
            {!project.outline ? (
              <p className="mx-2 mb-2 rounded-lg bg-white/5 px-2.5 py-2 text-[12px] leading-5 text-muted">
                These steps keep the arrows drawn on the map. Steps you add here follow the outline.
              </p>
            ) : null}
            <ol className="space-y-px" onDragLeave={(event) => event.currentTarget === event.target && drag && setDrag({ ...drag, to: null })}>
              {items.map((item, index) => {
                const task = byId.get(item.id);
                if (!task) return null;
                return (
                  <Fragment key={item.id}>
                    <Row
                      item={item}
                      task={task}
                      selected={task.id === selectedTaskId}
                      wired={drawnByHand(task)}
                      dropBefore={drag?.to === index}
                      dropAfter={drag?.to === items.length && index === items.length - 1}
                      register={(element) => {
                        if (element) inputs.current.set(item.id, element);
                        else inputs.current.delete(item.id);
                      }}
                      onKeyDown={(event) => onKeyDown(event, index)}
                      onPaste={(event) => onPaste(event, index)}
                      onDragStart={() => setDrag({ from: index, to: null })}
                      onDragEnd={() => setDrag(null)}
                      onDragOver={(before) => {
                        if (!drag) return;
                        const to = before ? index : index + 1;
                        if (drag.to !== to) setDrag({ ...drag, to });
                      }}
                      onDrop={() => {
                        if (drag && drag.to !== null) save(moveBlock(items, drag.from, drag.to));
                        setDrag(null);
                      }}
                      onSlash={() => {
                        const above = index > 0 ? items[index - 1]!.id : null;
                        const name = above ? byId.get(above)?.name : undefined;
                        const label = above ? `Adds after “${name || "Untitled step"}”` : "Adds at the top";
                        setAddSaved({ after: above, depth: item.depth, replace: item.id, label });
                      }}
                    />
                    {addSaved && pickerUnder === item.id ? <SavedPicker place={addSaved} /> : null}
                  </Fragment>
                );
              })}
            </ol>
            <button
              type="button"
              onClick={() => appendStep(projectId)}
              className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-text"
            >
              <Plus size={14} /> Add step
            </button>
            {addSaved && !pickerUnder ? (
              <SavedPicker place={addSaved} />
            ) : (
              <button
                type="button"
                onClick={() => setAddSaved(placeFor(projectId, null))}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-text"
              >
                <BookmarkPlus size={14} /> Add a saved step
              </button>
            )}
            <Draft projectId={projectId} big={false} />
          </>
        )}
      </div>
      {items.length ? <PlanBar projectId={projectId} /> : null}
    </aside>
  );
}

function Row({
  item,
  task,
  selected,
  wired,
  dropBefore,
  dropAfter,
  register,
  onKeyDown,
  onPaste,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onSlash,
}: {
  item: OutlineItem;
  task: Task;
  selected: boolean;
  wired: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  register: (element: HTMLInputElement | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (before: boolean) => void;
  onDrop: () => void;
  onSlash: () => void;
}) {
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const dispatch = useShepherd((store) => store.dispatch);
  const selectTask = useShepherd((store) => store.selectTask);
  const focusTask = useShepherd((store) => store.focusTask);
  const takeStep = useNextStep();
  const stage = stageOf(task, tasks, deps);
  const Icon = stageIcon[stage];
  const step = needsYou(task, tasks, deps) ? nextStep(task, stage) : null;
  const spin = stage === "running" || stage === "updating";

  return (
    <li
      className={cx("group relative flex h-9 items-center gap-1.5 rounded-lg pr-1", selected ? "bg-surface-3" : "hover:bg-surface-2")}
      style={{ paddingLeft: 2 + item.depth * INDENT_PX }}
      onDragOver={(event) => {
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        onDragOver(event.clientY < box.top + box.height / 2);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      title={stageHint(task, stage, tasks, deps)}
    >
      {Array.from({ length: item.depth }, (_, level) => (
        <span key={level} aria-hidden className="absolute bottom-0 top-0 w-px bg-line-strong" style={{ left: 13 + level * INDENT_PX }} />
      ))}
      {dropBefore ? <span aria-hidden className="absolute inset-x-1 -top-px h-0.5 rounded bg-brass" /> : null}
      {dropAfter ? <span aria-hidden className="absolute inset-x-1 -bottom-px h-0.5 rounded bg-brass" /> : null}
      <span
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", task.id);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        aria-label="Drag to move"
        className="cursor-grab text-faint opacity-0 hover:text-text group-hover:opacity-100"
      >
        <GripVertical size={14} />
      </span>
      <button type="button" aria-label={STAGE_LABEL[stage]} title={STAGE_LABEL[stage]} onClick={() => selectTask(task.id)} className="shrink-0">
        <Icon size={15} strokeWidth={2.25} className={cx(stageText[stage], spin && "animate-spin")} />
      </button>
      <input
        ref={register}
        value={task.name}
        placeholder="Name this step, or type / for a saved step"
        aria-label="Step name"
        onChange={(event) => {
          if (!task.name && event.target.value === "/" && task.status === "queued" && !task.git) onSlash();
          else dispatch({ type: "updateTask", id: task.id, patch: { name: event.target.value } });
        }}
        onFocus={() => focusTask(task.id)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className={cx(
          "h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint",
          stage === "verified" ? "text-muted" : "text-text",
        )}
      />
      {wired ? (
        <span title="Waits for the arrows you drew on the map, not the outline" className="shrink-0 text-faint">
          <Waypoints size={12} />
        </span>
      ) : null}
      {step ? (
        <button
          type="button"
          onClick={() => takeStep(task, step)}
          className={cx(
            "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium hover:brightness-110",
            stage === "failed" ? "bg-failed text-rose-950" : "bg-brass text-ink",
          )}
        >
          {STEP_LABEL[step]}
        </button>
      ) : null}
      <AgentPicker task={task} />
      <button
        type="button"
        aria-label="Open step"
        title="Open step"
        onClick={() => selectTask(task.id)}
        className="shrink-0 rounded p-0.5 text-faint opacity-0 hover:text-text group-hover:opacity-100"
      >
        <ChevronRight size={14} />
      </button>
    </li>
  );
}

function AgentPicker({ task }: { task: Task }) {
  const dispatch = useShepherd((store) => store.dispatch);
  const assignee = assigneeFor(task);
  const catalog = useModels();
  const provider = providerOf(task);
  const model = provider && task.model ? `, with ${modelName(task.model, catalog, provider)}` : "";
  return (
    <label className="relative shrink-0 cursor-pointer" title={`${assignee.name} does this${model}. Click to change who.`}>
      <Avatar kind={assignee.kind} size={22} />
      <select
        aria-label="Who does this step"
        value={task.runner === "human" ? "human" : (task.agentId ?? "")}
        disabled={task.status === "running"}
        onChange={(event) => {
          const value = event.target.value;
          dispatch(
            value === "human"
              ? { type: "reassign", id: task.id, agentId: null, runner: "human" }
              : { type: "reassign", id: task.id, agentId: value || null, runner: "agent" },
          );
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {task.runner === "agent" && !task.agentId ? <option value="">Nobody yet</option> : null}
        {PICKABLE.map((agent) => (
          <option key={agent.id} value={agent.id} disabled={task.runner === "human" && !!task.git}>
            {agent.name}
          </option>
        ))}
        <option value="human" disabled={task.runner === "agent" && !!task.git}>
          You
        </option>
      </select>
    </label>
  );
}

function Start({ projectId, onWrite }: { projectId: string; onWrite: () => void }) {
  const addSaved = useShepherd((store) => store.ui.addSaved);
  const setAddSaved = useShepherd((store) => store.setAddSaved);
  return (
    <div className="space-y-3 px-2 pt-2">
      <Draft projectId={projectId} big />
      <div className="flex items-center gap-2 text-[11px] text-faint">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <Button className="w-full" onClick={onWrite}>
        <Plus size={15} /> Write the steps yourself
      </Button>
      {addSaved ? (
        <SavedPicker place={addSaved} />
      ) : (
        <button
          type="button"
          className="block w-full text-center text-[12px] text-brass hover:underline"
          onClick={() => setAddSaved(placeFor(projectId, null))}
        >
          or add a saved step
        </button>
      )}
      <p className="text-[12px] leading-5 text-faint">
        Steps run top to bottom, each with the work and report of the steps before it. Indent a step with Tab to run it at the same time as
        the steps beside it, after the step above. Pasting a list makes one step per line.
      </p>
    </div>
  );
}

const DRAFT_KEY = "shepherd.draftModel";

/** The model and thinking the last draft used, so the next one starts there. */
function lastDraftChoice(): Pick<Task, "model" | "effort"> {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") as Record<string, unknown>;
    return { ...(isModelId(saved.model) ? { model: saved.model } : {}), ...(isEffort(saved.effort) ? { effort: saved.effort } : {}) };
  } catch {
    return {};
  }
}

/** Asks Codex to break a goal into steps, then adds them to the end of the outline. */
function Draft({ projectId, big }: { projectId: string; big: boolean }) {
  const dispatch = useShepherd((store) => store.dispatch);
  const draftToken = useShepherd((store) => store.ui.draftToken);
  const requestFit = useShepherd((store) => store.requestFit);
  const catalog = useModels();
  const [choice, setChoice] = useState(lastDraftChoice);
  const [open, setOpen] = useState(big);
  const [goal, setGoal] = useState("");
  const [started, setStarted] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!draftToken) return;
    const seed = useShepherd.getState().ui.draftSeed;
    if (seed) setGoal(seed);
    setOpen(true);
    requestAnimationFrame(() => box.current?.focus());
  }, [draftToken]);
  useEffect(() => {
    if (started === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [started]);
  useEffect(() => () => abort.current?.abort(), [projectId]);

  const submit = async () => {
    const text = goal.trim();
    if (!text || started !== null) return;
    setError("");
    setStarted(Date.now());
    setNow(Date.now());
    const controller = new AbortController();
    abort.current = controller;
    const result = await draftSteps(projectId, text, choice, controller.signal);
    abort.current = null;
    setStarted(null);
    if (!Array.isArray(result)) {
      if (!controller.signal.aborted) setError(result.error);
      return;
    }
    const after = outlineOf(useShepherd.getState().state, projectId).at(-1)?.id ?? null;
    const steps = result.map((step) => ({ task: stepFrom(projectId, step.name, step.prompt, DEFAULT_AGENT_ID, text), depth: step.depth }));
    dispatch({ type: "addSteps", projectId, after, steps });
    setGoal("");
    if (!big) setOpen(false);
    requestFit();
  };
  const pick = (model: string | null, effort: Effort | null) => {
    const next = { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
    setChoice(next);
    localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => box.current?.focus());
        }}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-text"
      >
        <Sparkles size={14} /> Draft steps from a goal
      </button>
    );
  }
  const busy = started !== null;
  return (
    <div className={cx("space-y-2", !big && "mx-1 mt-2 rounded-lg border border-line bg-surface-2/50 p-2.5")}>
      {big ? <div className="text-[15px] font-semibold text-text">What do you want done?</div> : null}
      <textarea
        ref={box}
        value={goal}
        disabled={busy}
        onChange={(event) => setGoal(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape" && !big) setOpen(false);
        }}
        placeholder={big ? "Add a dark mode toggle to the settings page, with tests" : "Another goal to break into steps"}
        className="min-h-24 w-full resize-y rounded-lg border border-line-strong bg-black/20 px-3 py-2 text-[13px] leading-5 text-text outline-none placeholder:text-faint focus:border-brass disabled:opacity-60"
      />
      <ModelPicker provider="codex" catalog={catalog} model={choice.model} effort={choice.effort} disabled={busy} onChange={pick} />
      {error ? <p className="text-[12px] leading-5 text-failed">{error}</p> : null}
      <div className="flex items-center gap-2">
        {busy ? (
          <>
            <Button disabled variant={big ? "primary" : "ghost"}>
              <LoaderCircle size={14} className="animate-spin" /> Drafting… {Math.max(0, Math.round((now - started) / 1000))}s
            </Button>
            <Button variant="quiet" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button variant={big ? "primary" : "ghost"} disabled={!goal.trim()} onClick={() => void submit()}>
              <Sparkles size={14} /> Draft steps
            </Button>
            {!big ? (
              <Button variant="quiet" onClick={() => setOpen(false)}>
                Close
              </Button>
            ) : null}
          </>
        )}
      </div>
      <p className="text-[11px] leading-4 text-faint">
        {busy ? "Codex is reading the project folder. This can take a minute." : "Codex reads the project folder and suggests steps. Nothing runs until you press Run."}
      </p>
    </div>
  );
}

/** How far the plan has got, and the one button that runs, stops or merges it. */
function PlanBar({ projectId }: { projectId: string }) {
  const project = useShepherd((store) => store.state.projects.find((item) => item.id === projectId));
  const allTasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const [busy, setBusy] = useState(false);
  const tasks = allTasks.filter((task) => task.projectId === projectId);
  const score = progress(tasks);
  const working = tasks.filter((task) => task.status === "running").length;
  const yours = tasks.filter((task) => needsYou(task, allTasks, deps)).length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const unmerged = tasks.filter((task) => task.git && !task.git.merged);
  const target = tasks.find((task) => task.git)?.git?.target ?? "main";
  const started = tasks.some((task) => task.status !== "queued" || task.git);
  const running = !!project?.running;
  const issues = tasks.reduce((count, task) => count + openIssues(task, allTasks).length, 0);

  const status = running
    ? working
      ? [`${working} working`, yours ? `${yours} ${yours === 1 ? "needs" : "need"} you` : ""].filter(Boolean).join(" · ")
      : failed
        ? `${failed} failed. Retry it to go on.`
        : yours
          ? "Waiting for you"
          : "Starting…"
    : score.complete
      ? issues
        ? `All steps done, with ${issues === 1 ? "1 known issue" : `${issues} known issues`}`
        : "All steps done"
      : failed
        ? `${failed} ${failed === 1 ? "step" : "steps"} failed`
        : `${score.done} of ${score.total} done`;

  const act = async (work: () => Promise<string | null>) => {
    setBusy(true);
    await work();
    setBusy(false);
  };

  return (
    <div className="space-y-2.5 border-t border-line p-3">
      <div className="flex items-center justify-between text-[12px]">
        <span className={cx(running ? "text-running" : score.complete ? "text-completed" : failed ? "text-failed" : "text-muted")}>{status}</span>
        <span className="font-mono text-faint">
          {score.done}/{score.total}
        </span>
      </div>
      <ProgressBar percent={score.percent} tone={cx(score.complete ? "bg-completed" : "bg-running", running && "stripes")} />
      {running ? (
        <Button size="lg" className="w-full" disabled={busy} onClick={() => void act(() => stopPlan(projectId))}>
          <Square size={13} /> Stop
        </Button>
      ) : score.complete ? (
        unmerged.length ? (
          <Button size="lg" variant="primary" className="w-full" disabled={busy} onClick={() => void act(() => mergePlan(projectId))}>
            <GitMerge size={15} /> {busy ? "Merging…" : `Merge the result into ${target}`}
          </Button>
        ) : (
          <p className="text-center text-[12px] text-faint">{tasks.some((task) => task.git) ? `Merged into ${target}.` : "Nothing to merge."}</p>
        )
      ) : (
        <Button size="lg" variant="primary" className="w-full" disabled={busy} onClick={() => void act(() => runPlan(projectId))}>
          <Play size={15} /> {started ? "Run the rest" : "Run"}
        </Button>
      )}
    </div>
  );
}
