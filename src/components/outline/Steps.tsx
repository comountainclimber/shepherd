import { GripVertical, Waypoints } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from "react";
import { DEFAULT_AGENT_ID, newStep } from "../../model/factory";
import { cx } from "../../model/format";
import { tint } from "../../model/graphs";
import { modelName, providerOf } from "../../model/models";
import { indent, moveBlock, moveDown, moveUp, outdent, outlineOf, parseList, subtreeEnd } from "../../model/outline";
import { STAGE_LABEL, STEP_LABEL, assigneeFor, needsYou, nextStep, stageHint, stageOf } from "../../model/stage";
import type { Goal, OutlineItem, Task } from "../../model/types";
import { AGENTS } from "../../model/workspace";
import { useShepherd } from "../../store";
import { SavedPicker } from "../saved/SavedPicker";
import { useModels } from "../useModels";
import { useNextStep } from "../useNextStep";
import { Avatar, stageIcon, stageText } from "../ui";

const NAME_LIMIT = 80;
const INDENT_PX = 20;
const PICKABLE = [...AGENTS].sort((a, b) => (a.provider === "codex" ? -1 : b.provider === "codex" ? 1 : 0));

/** A line too long for a name keeps the whole line as the step's prompt. */
export function stepFrom(goalId: string, line: string, prompt: string, agentId: string | null, context = ""): Task {
  let name = line;
  if (line.length > NAME_LIMIT) {
    const cut = line.slice(0, NAME_LIMIT);
    name = `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : NAME_LIMIT)}…`;
  }
  const task = newStep(useShepherd.getState().state.goals.find((goal) => goal.id === goalId)!.projectId, name, prompt || (name === line ? "" : line), agentId, goalId);
  return context ? { ...task, description: context } : task;
}

export function editable(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT" || element.isContentEditable);
}

/** The tree's guide lines for the objective and graph levels, drawn left of a step row. */
const GUIDES = [-31, -15];

/**
 * One graph's steps as rows you type into, tinted with the graph's colour. Enter adds a step, Tab
 * runs it side by side with the one above, and the map follows the order.
 */
export function GraphSteps({ goal, color, pickerUnder }: { goal: Goal; color: string; pickerUnder: string | null }) {
  const goalId = goal.id;
  const state = useShepherd((store) => store.state);
  const selectedTaskId = useShepherd((store) => store.ui.selectedTaskId);
  const addSaved = useShepherd((store) => store.ui.addSaved);
  const setAddSaved = useShepherd((store) => store.setAddSaved);
  const dispatch = useShepherd((store) => store.dispatch);
  const items = useMemo(() => outlineOf(state, goalId), [state, goalId]);
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

  // A blank step picked anywhere else, such as on the map or from ⌘K, gets the cursor so it can be named.
  useEffect(() => {
    const task = selectedTaskId ? latest.current.byId.get(selectedTaskId) : undefined;
    if (task && task.goalId === goalId && !task.name && !editable(document.activeElement)) setPendingFocus({ id: task.id, at: "start" });
  }, [selectedTaskId, goalId]);

  const save = (next: OutlineItem[] | null) => {
    if (next) dispatch({ type: "setOutline", goalId, items: next });
  };

  const add = (after: string | null, depth: number, from?: Task) => {
    const agentId = from?.runner === "agent" ? from.agentId : DEFAULT_AGENT_ID;
    const task = newStep(goal.projectId, "", "", agentId, goalId);
    dispatch({ type: "addSteps", goalId, after, steps: [{ task, depth }] });
    setPendingFocus({ id: task.id, at: "start" });
  };

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
      const first = stepFrom(goalId, lines[0]!.name, "", agentId);
      dispatch({ type: "updateTask", id: task.id, patch: { name: first.name, objective: first.objective } });
      rest = lines.slice(1);
    }
    const steps = rest.map((line) => ({ task: stepFrom(goalId, line.name, "", agentId), depth: Math.max(0, base + line.depth) }));
    const after = items[subtreeEnd(items, index) - 1]!.id;
    dispatch({ type: "addSteps", goalId, after, steps });
    const last = steps.at(-1);
    if (last) setPendingFocus({ id: last.task.id, at: "end" });
  };

  const drawnByHand = (task: Task) =>
    !!goal.outline && (!!task.wired || state.dependencies.some((dep) => dep.target === task.id && !dep.outline));

  if (!items.length) return null;
  return (
    <li>
      {!goal.outline ? (
        <p className="relative mb-1 ml-[44px] rounded-lg bg-white/5 px-2.5 py-2 text-[12px] leading-5 text-muted">
          These steps keep the arrows drawn on the map. Steps you add here follow the outline.
        </p>
      ) : null}
      <ol className="flex flex-col gap-px" onDragLeave={(event) => event.currentTarget === event.target && drag && setDrag({ ...drag, to: null })}>
        {items.map((item, index) => {
          const task = byId.get(item.id);
          if (!task) return null;
          return (
            <Fragment key={item.id}>
              <Row
                item={item}
                task={task}
                color={color}
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
              {addSaved && pickerUnder === item.id ? (
                <li className="ml-[44px] py-1">
                  <SavedPicker place={addSaved} />
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ol>
    </li>
  );
}

function Row({
  item,
  task,
  color,
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
  color: string;
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
  const indentPx = item.depth * INDENT_PX;
  const style = {
    paddingLeft: 16 + indentPx,
    "--row": tint(color, selected ? 22 : 9),
    "--row-hover": tint(color, selected ? 22 : 14),
    boxShadow: selected ? `inset 0 0 0 1px ${color}` : undefined,
  } as CSSProperties;

  return (
    <li
      className="group relative ml-[44px] flex h-9 cursor-pointer select-none items-center gap-1.5 rounded-lg bg-(--row) pr-1 hover:bg-(--row-hover)"
      style={style}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("input,button,select,label,[draggable]")) return;
        selectTask(task.id);
      }}
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
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] rounded-l-lg" style={{ background: color }} />
      {GUIDES.map((left) => (
        <span key={left} aria-hidden className="absolute inset-y-0 w-px bg-white/12" style={{ left }} />
      ))}
      {Array.from({ length: item.depth }, (_, level) => (
        <span key={level} aria-hidden className="absolute inset-y-0 w-px bg-white/12" style={{ left: 23 + level * INDENT_PX }} />
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
        className="absolute top-1/2 -translate-y-1/2 cursor-grab text-faint opacity-0 hover:text-text group-hover:opacity-100"
        style={{ left: 2 + indentPx }}
      >
        <GripVertical size={12} />
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
        onClick={() => selectTask(task.id)}
        onFocus={() => focusTask(task.id)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className={cx(
          "h-full min-w-0 flex-1 cursor-text bg-transparent text-[13px] outline-none placeholder:text-faint",
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
      <span aria-hidden className="w-1 shrink-0" />
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
