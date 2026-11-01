import { ChevronDown, LoaderCircle, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { cx } from "../../model/format";
import { modelName, providerOf } from "../../model/models";
import { hasCycle, incoming, outgoing } from "../../model/selectors";
import type { Task } from "../../model/types";
import { AGENTS } from "../../model/workspace";
import { draftChecklist } from "../../runner/live";
import { useShepherd } from "../../store";
import { Avatar, Button, Select, TextArea, TextInput } from "../ui";
import { useModels } from "../useModels";
import { ModelPicker } from "./ModelPicker";
import { useSelectedTask } from "./useSelectedTask";

const PICKABLE = [...AGENTS].sort((a, b) => (a.provider === "codex" ? -1 : b.provider === "codex" ? 1 : 0));

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** A text box that saves shortly after you stop typing, and when you leave it. */
function SavedText({ value, onSave, ...props }: { value: string; onSave: (value: string) => void } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const [text, setText] = useState(value);
  const editing = useRef(false);
  const timer = useRef(0);
  const save = useRef(onSave);
  save.current = onSave;
  useEffect(() => {
    if (!editing.current) setText(value);
  }, [value]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <TextArea
      {...props}
      value={text}
      onFocus={() => (editing.current = true)}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => save.current(next), 700);
      }}
      onBlur={() => {
        editing.current = false;
        window.clearTimeout(timer.current);
        if (text !== value) save.current(text);
      }}
    />
  );
}

export function Step() {
  const task = useSelectedTask();
  return <StepFields key={task.id} task={task} />;
}

function StepFields({ task }: { task: Task }) {
  const dispatch = useShepherd((store) => store.dispatch);
  const agent = task.runner === "agent";

  return (
    <div className="space-y-4 pb-2">
      <section>
        <div className="mb-1.5 text-[12px] font-medium text-muted">Who does it</div>
        <WhoDoesIt task={task} />
        <StepModel task={task} />
      </section>
      <section>
        <div className="mb-1.5 text-[12px] font-medium text-muted">{agent ? "What to tell the agent" : "What you do"}</div>
        <SavedText
          value={task.objective}
          onSave={(objective) => dispatch({ type: "updateTask", id: task.id, patch: { objective } })}
          placeholder={
            agent
              ? "Be specific: which files or pages, what to build or change, and how it should behave when it is done."
              : "What you need to do before the next steps can start."
          }
          className="min-h-36"
        />
        {agent ? (
          <p className="mt-1 text-[11px] leading-4 text-faint">
            The agent also gets the reports of the steps before it, and their work is already merged into its branch.
          </p>
        ) : (
          <DraftChecklist task={task} />
        )}
      </section>
      <Order task={task} />
      <MoreOptions task={task} />
      <div className="border-t border-line pt-3">
        <Button
          variant="quiet"
          className="text-failed hover:bg-failed/10"
          disabled={task.status === "running"}
          onClick={() => {
            if (window.confirm(`Delete “${task.name || "this step"}”?${task.git ? " Its branch stays in git." : ""}`)) dispatch({ type: "deleteTask", id: task.id });
          }}
        >
          <Trash2 size={14} /> Delete this step
        </Button>
      </div>
    </div>
  );
}

/** A checklist for your step, written by Codex from what the earlier steps did, for you to use or discard. */
function DraftChecklist({ task }: { task: Task }) {
  const dispatch = useShepherd((store) => store.dispatch);
  const earlier = useShepherd((store) => store.state.dependencies.some((dep) => dep.target === task.id));
  const [asking, setAsking] = useState(false);
  if (!earlier && !task.checklist) return null;

  if (task.drafting || asking) {
    return (
      <p className="mt-1.5 flex items-center gap-2 text-[12px] text-muted">
        <LoaderCircle size={13} className="animate-spin" /> Writing a checklist from the earlier steps' work…
      </p>
    );
  }
  if (task.checklist) {
    return (
      <div className="mt-2 space-y-2 rounded-lg border border-brass/40 bg-brass/5 p-2.5">
        <div className="text-[12px] font-medium text-muted">Suggested checklist</div>
        <p className="max-h-72 overflow-auto whitespace-pre-wrap text-[12px] leading-5 text-text [overflow-wrap:anywhere]">{task.checklist}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => dispatch({ type: "settleChecklist", id: task.id, use: true })}>
            Use it
          </Button>
          <Button size="sm" variant="quiet" onClick={() => dispatch({ type: "settleChecklist", id: task.id, use: false })}>
            Discard
          </Button>
          <span className="text-[11px] text-faint">Using it replaces what is written above.</span>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="mt-1.5 text-[12px] text-brass hover:underline"
      onClick={async () => {
        setAsking(true);
        await draftChecklist(task.id);
        setAsking(false);
      }}
    >
      Draft it from the earlier steps' work
    </button>
  );
}

function WhoDoesIt({ task }: { task: Task }) {
  const dispatch = useShepherd((store) => store.dispatch);
  const running = task.status === "running";
  const choices = [
    ...PICKABLE.map((agent) => ({
      id: agent.id,
      label: agent.name,
      kind: agent.provider === "codex" ? ("codex" as const) : ("claude" as const),
      active: task.runner === "agent" && task.agentId === agent.id,
      disabled: running || (task.runner === "human" && !!task.git),
      pick: () => dispatch({ type: "reassign", id: task.id, agentId: agent.id, runner: "agent" }),
    })),
    {
      id: "human",
      label: "You",
      kind: "person" as const,
      active: task.runner === "human",
      disabled: running || (task.runner === "agent" && !!task.git),
      pick: () => dispatch({ type: "reassign", id: task.id, agentId: null, runner: "human" }),
    },
  ];
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          disabled={choice.disabled && !choice.active}
          title={
            task.sessionId && !choice.active && choice.kind !== "person"
              ? `${choice.label} starts a fresh conversation. The work on this step's branch stays.`
              : undefined
          }
          onClick={() => !choice.active && choice.pick()}
          className={cx(
            "flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40",
            choice.active ? "border-brass bg-brass/10 text-text" : "border-line-strong text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          <Avatar kind={choice.kind} size={20} />
          <span className="truncate">{choice.label}</span>
        </button>
      ))}
    </div>
  );
}

function StepModel({ task }: { task: Task }) {
  const dispatch = useShepherd((store) => store.dispatch);
  const catalog = useModels();
  const provider = providerOf(task);
  if (!provider) return null;
  const running = task.status === "running";
  const picked = task.model ? modelName(task.model, catalog, provider) : null;
  const note = running
    ? "You can change it once this run ends."
    : task.sessionId && picked
      ? `Its next run picks up the earlier conversation, now with ${picked}.`
      : undefined;
  return (
    <ModelPicker
      provider={provider}
      catalog={catalog}
      model={task.model}
      effort={task.effort}
      disabled={running}
      note={note}
      onChange={(model, effort) => dispatch({ type: "setModel", id: task.id, model, effort })}
    />
  );
}

/** What this step waits for and what waits for it. */
function Order({ task }: { task: Task }) {
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const project = useShepherd((store) => store.state.projects.find((item) => item.id === task.projectId));
  const dispatch = useShepherd((store) => store.dispatch);
  const [adding, setAdding] = useState("");
  const name = (id: string) => tasks.find((item) => item.id === id)?.name || "Untitled step";
  const before = incoming(task.id, deps);
  const after = outgoing(task.id, deps);
  const byHand = !!project?.outline && (!!task.wired || before.some((dep) => !dep.outline));
  const candidates = tasks
    .filter((item) => item.projectId === task.projectId && item.id !== task.id)
    .filter((item) => !before.some((dep) => dep.source === item.id))
    .filter((item) => !hasCycle([...deps, { source: item.id, target: task.id }]));

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-muted">Starts after</span>
        {byHand ? (
          <button type="button" className="text-[12px] text-brass hover:underline" onClick={() => dispatch({ type: "followOutline", id: task.id })}>
            Follow the outline instead
          </button>
        ) : null}
      </div>
      <ul className="space-y-1">
        {before.map((dep) => (
          <li key={dep.id} className="flex items-center gap-2 rounded-lg bg-black/20 px-2.5 py-1 text-[13px]">
            <span className="min-w-0 flex-1 truncate">{name(dep.source)}</span>
            <button
              type="button"
              aria-label={`Stop waiting for ${name(dep.source)}`}
              title="Stop waiting for it"
              className="rounded-md p-1 text-faint hover:bg-failed/15 hover:text-failed"
              onClick={() => dispatch({ type: "disconnect", id: dep.id })}
            >
              <X size={13} />
            </button>
          </li>
        ))}
        {!before.length ? <li className="text-[12px] text-faint">Nothing. It starts as soon as you press Run.</li> : null}
      </ul>
      {candidates.length ? (
        <Select
          value={adding}
          onChange={(event) => {
            const source = event.target.value;
            setAdding("");
            if (source) dispatch({ type: "connect", source, target: task.id, gate: "verified" });
          }}
        >
          <option value="">Also wait for…</option>
          {candidates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name || "Untitled step"}
            </option>
          ))}
        </Select>
      ) : null}
      <p className="text-[11px] leading-4 text-faint">
        {byHand
          ? "You set these by hand, so moving the step in the outline doesn't change them."
          : "These come from the outline. Changing them here, or drawing arrows on the map, sets them by hand."}
      </p>
      {after.length ? (
        <div className="text-[12px] leading-5 text-muted">
          <span className="text-faint">Then: </span>
          {after.map((dep) => name(dep.target)).join(", ")}
        </div>
      ) : null}
    </section>
  );
}

/** Checks, reviews and extra context. None of it is needed to run a step. */
function MoreOptions({ task }: { task: Task }) {
  const dispatch = useShepherd((store) => store.dispatch);
  const agent = task.runner === "agent";
  const review = task.verification.some((check) => check.kind === "review");
  const extras = task.acceptance.length > 0 || !!task.checkCommand || review || !!task.independent;
  const [open, setOpen] = useState(extras);
  const [checkCommand, setCheckCommand] = useState(task.checkCommand ?? "");
  useEffect(() => setCheckCommand(task.checkCommand ?? ""), [task.checkCommand]);

  return (
    <section className="rounded-lg border border-line">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-[12px] font-medium text-muted hover:text-text"
      >
        <span>More options{!open && extras ? " (some set)" : ""}</span>
        <ChevronDown size={14} className={cx("transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-line px-3 pb-3 pt-2.5">
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Background</span>
            <SavedText
              value={task.description}
              onSave={(description) => dispatch({ type: "updateTask", id: task.id, patch: { description } })}
              placeholder="Anything else worth knowing, like the overall goal"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Done when (one per line)</span>
            <SavedText
              value={task.acceptance.join("\n")}
              onSave={(text) => dispatch({ type: "updateTask", id: task.id, patch: { acceptance: lines(text) } })}
              placeholder="The page loads without errors"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Check command</span>
            <TextInput
              className="font-mono"
              value={checkCommand}
              placeholder="npm test"
              onChange={(event) => setCheckCommand(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              onBlur={() => checkCommand.trim() !== (task.checkCommand ?? "") && dispatch({ type: "setCheckCommand", id: task.id, command: checkCommand })}
            />
            <span className="mt-1 block text-[11px] leading-4 text-faint">
              Runs in the step's folder after the work. The step is done only when it exits 0. A failed check is retried twice while the plan runs.
            </span>
          </label>
          {agent ? (
            <>
              <Toggle
                checked={review}
                disabled={task.status === "running"}
                onChange={(on) => dispatch({ type: "setReview", id: task.id, on })}
                label="Ask me to review it"
                hint="The plan waits for you to accept the work before the next steps start."
              />
              <Toggle
                checked={!!task.independent}
                onChange={(independent) => dispatch({ type: "updateTask", id: task.id, patch: { independent } })}
                label="Judge independently"
                hint="It sees the earlier steps' files, not what those agents said about them. Good for a final review step."
              />
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Toggle({
  checked,
  disabled = false,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className={cx("flex items-start gap-3 rounded-lg bg-black/20 px-3 py-2 text-[13px]", disabled ? "opacity-50" : "cursor-pointer")}>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
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
