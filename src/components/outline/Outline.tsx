import { BookmarkPlus, FolderPlus, GitBranch, LoaderCircle, Plus, Sparkles, Workflow, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_AGENT_ID } from "../../model/factory";
import { cx } from "../../model/format";
import { FALLBACK_COLOR, graphColor } from "../../model/graphs";
import { isEffort, isModelId } from "../../model/models";
import { outlineOf } from "../../model/outline";
import type { Effort, Task } from "../../model/types";
import { draftSteps } from "../../runner/live";
import { useShepherd } from "../../store";
import { ModelPicker } from "../inspector/ModelPicker";
import { placeFor } from "../saved/addSaved";
import { SavedPicker } from "../saved/SavedPicker";
import { useModels } from "../useModels";
import { Button } from "../ui";
import { appendStep } from "./appendStep";
import { GraphDialogs } from "./GraphActions";
import { editable, stepFrom } from "./Steps";
import { Tree, currentRepo, moveGraph, newGraph, newObjective, pickerRow, useTree } from "./Tree";

/** The sidebar: every repo's objectives and graphs as a tree, then what you can do where you are. */
export function Outline() {
  const menu = useTree((tree) => tree.menu);
  const setMenu = useTree((tree) => tree.setMenu);
  const projectId = useShepherd((store) => store.ui.projectId);
  const objectiveId = useShepherd((store) => store.ui.objectiveId);

  // The repo of whatever you pick, here or on the map, opens and stays open after you pick elsewhere.
  useEffect(() => {
    const tree = useTree.getState();
    if (objectiveId && tree.repos[projectId] !== true) tree.setRepo(projectId, true);
  }, [projectId, objectiveId]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const { ui, state, setNewProjectOpen } = useShepherd.getState();
      if (ui.paletteOpen || ui.newProjectOpen || ui.newTaskProjectId || ui.saveFor || ui.manageSaved) return;
      if (editable(event.target)) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setNewProjectOpen(true);
      } else if (command && !event.shiftKey && event.key.toLowerCase() === "n") {
        const repo = currentRepo(state, useTree.getState(), ui);
        if (!repo) return;
        event.preventDefault();
        newObjective(repo.id);
      } else if (event.altKey && !command && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        if (!ui.goalId) return;
        event.preventDefault();
        moveGraph(ui.goalId, event.key === "ArrowUp" ? -1 : 1);
      } else if (event.key === "n" && !command && !event.altKey) {
        event.preventDefault();
        appendStep(ui.goalId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A click anywhere else or Escape closes a row's menu, before Escape does anything else.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu("");
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    // The menu floats where its row was, so it closes once anything scrolls or resizes.
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu, setMenu]);

  return (
    <aside className="flex w-full shrink-0 flex-col border-r border-line bg-surface sm:w-[380px]">
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3 pt-2.5">
        <Tree />
        <Actions />
      </div>
      <GraphDialogs />
    </aside>
  );
}

/** What you can add where you are: steps to the focused graph, graphs, objectives, repos. */
function Actions() {
  const state = useShepherd((store) => store.state);
  const ui = useShepherd((store) => store.ui);
  const setAddSaved = useShepherd((store) => store.setAddSaved);
  const setNewProjectOpen = useShepherd((store) => store.setNewProjectOpen);
  const requestDraft = useShepherd((store) => store.requestDraft);
  const tree = useTree();
  const repo = currentRepo(state, tree, ui);
  const objective = ui.objectiveId ? state.objectives.find((item) => item.id === ui.objectiveId) : undefined;
  const graph = objective ? state.goals.find((goal) => goal.id === ui.goalId && goal.objectiveId === objective.id && goal.status !== "archived") : undefined;
  const open = graph?.status === "open";

  const addObjective = repo ? <Action icon={Plus} label={`New objective in ${repo.name}`} hint="⌘N" onClick={() => newObjective(repo.id)} /> : null;
  const addRepo = <Action icon={FolderPlus} label="Add a repo…" hint="⌘⇧O" onClick={() => setNewProjectOpen(true)} />;

  let where = "Workspace";
  let color = FALLBACK_COLOR;
  let actions: ReactNode;
  if (objective && graph) {
    where = `${objective.name} / ${graph.name}`;
    color = graphColor(graph);
    actions = (
      <>
        {open ? (
          <>
            <Action icon={Plus} label="Add step" hint="N" strong onClick={() => appendStep(graph.id)} />
            {ui.addSaved && !pickerRow(state, ui) ? (
              <div className="py-1">
                <SavedPicker place={ui.addSaved} />
              </div>
            ) : (
              <Action icon={BookmarkPlus} label="Add a saved step" onClick={() => setAddSaved(placeFor(graph.id, null))} />
            )}
            <Draft key={graph.id} goalId={graph.id} />
          </>
        ) : (
          <p className="px-2.5 py-1.5 text-[12px] leading-5 text-faint">This graph is done. Reopen it from its header to add steps.</p>
        )}
        <Divider />
        <Action icon={Workflow} label={`New graph in ${objective.name}`} onClick={() => newGraph(objective)} />
        {addObjective}
        {addRepo}
      </>
    );
  } else if (objective && repo) {
    where = `${repo.name} / ${objective.name}`;
    actions = (
      <>
        <Action icon={Workflow} label="New graph" strong onClick={() => newGraph(objective)} />
        <Action
          icon={Sparkles}
          label="Draft a graph from a goal"
          onClick={() => {
            newGraph(objective, false);
            requestDraft();
          }}
        />
        <Divider />
        {addObjective}
        {addRepo}
      </>
    );
  } else if (repo) {
    where = repo.name;
    actions = (
      <>
        <Action icon={Plus} label="New objective" hint="⌘N" strong onClick={() => newObjective(repo.id)} />
        {addRepo}
      </>
    );
  } else {
    actions = <Action icon={FolderPlus} label="Add a repo…" hint="⌘⇧O" strong onClick={() => setNewProjectOpen(true)} />;
  }

  return (
    <div className="mt-3 flex flex-col gap-0.5 px-0.5">
      <div className="flex items-center gap-2 px-2 pb-1.5 pt-1 text-[11px] text-faint">
        <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
        <span className="min-w-0 flex-1 truncate">{where}</span>
      </div>
      {graph?.branch ? (
        <div className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 px-2 pb-1.5 font-mono text-[11px] text-faint">
          <span className="inline-flex min-w-0 items-center gap-1 [overflow-wrap:anywhere]" title={graph.folder}>
            <GitBranch size={11} className="shrink-0" />
            {graph.branch} → {graph.base ?? "—"}
          </span>
          {graph.merged ? <span className="text-completed">Merged into {graph.merged.into}</span> : null}
        </div>
      ) : null}
      {actions}
    </div>
  );
}

function Action({ icon: Icon, label, hint, strong = false, onClick }: { icon: LucideIcon; label: string; hint?: string; strong?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx("flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-text", strong && "font-medium")}
    >
      <Icon size={14} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="font-mono text-[11px] text-faint">{hint}</span> : null}
    </button>
  );
}

function Divider() {
  return <div aria-hidden className="mx-2 my-1 h-px bg-line" />;
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
function Draft({ goalId }: { goalId: string }) {
  const dispatch = useShepherd((store) => store.dispatch);
  const draftToken = useShepherd((store) => store.ui.draftToken);
  const requestFit = useShepherd((store) => store.requestFit);
  const catalog = useModels();
  const [choice, setChoice] = useState(lastDraftChoice);
  const [open, setOpen] = useState(false);
  const [focusAsk, setFocusAsk] = useState(0);
  const [goal, setGoal] = useState(() => useShepherd.getState().state.goals.find((goal) => goal.id === goalId)?.goal ?? "");
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
    setFocusAsk((count) => count + 1);
  }, [draftToken]);
  // Puts the cursor in the box once it has rendered, however it was opened.
  useEffect(() => {
    if (focusAsk) box.current?.focus();
  }, [focusAsk]);
  useEffect(() => {
    if (started === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [started]);
  useEffect(() => () => abort.current?.abort(), [goalId]);

  const submit = async () => {
    const text = goal.trim();
    if (!text || started !== null) return;
    setError("");
    setStarted(Date.now());
    setNow(Date.now());
    const controller = new AbortController();
    abort.current = controller;
    dispatch({ type: "updateGoal", id: goalId, patch: { goal: text } });
    const result = await draftSteps(goalId, text, choice, controller.signal);
    if (controller.signal.aborted) return;
    abort.current = null;
    setStarted(null);
    if (!Array.isArray(result)) {
      if (!controller.signal.aborted) setError(result.error);
      return;
    }
    const after = outlineOf(useShepherd.getState().state, goalId).at(-1)?.id ?? null;
    const steps = result.map((step) => ({ task: stepFrom(goalId, step.name, step.prompt, DEFAULT_AGENT_ID, text), depth: step.depth }));
    dispatch({ type: "addSteps", goalId, after, steps });
    setGoal("");
    setOpen(false);
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
          setFocusAsk((count) => count + 1);
        }}
        className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-muted hover:bg-surface-2 hover:text-text"
      >
        <Sparkles size={14} className="shrink-0" /> Draft steps from a goal
      </button>
    );
  }
  const busy = started !== null;
  return (
    <div className="mx-1 my-1 space-y-2 rounded-lg border border-line bg-surface-2/50 p-2.5">
      <textarea
        ref={box}
        value={goal}
        disabled={busy}
        onChange={(event) => setGoal(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") setOpen(false);
        }}
        placeholder="Add a dark mode toggle to the settings page, with tests"
        className="min-h-24 w-full resize-y rounded-lg border border-line-strong bg-black/20 px-3 py-2 text-[13px] leading-5 text-text outline-none placeholder:text-faint focus:border-brass disabled:opacity-60"
      />
      <ModelPicker provider="codex" catalog={catalog} model={choice.model} effort={choice.effort} disabled={busy} onChange={pick} />
      {error ? <p className="text-[12px] leading-5 text-failed">{error}</p> : null}
      <div className="flex items-center gap-2">
        {busy ? (
          <>
            <Button disabled variant="ghost">
              <LoaderCircle size={14} className="animate-spin" /> Drafting… {Math.max(0, Math.round((now - started) / 1000))}s
            </Button>
            <Button variant="quiet" onClick={() => { abort.current?.abort(); abort.current = null; setStarted(null); }}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" disabled={!goal.trim()} onClick={() => void submit()}>
              <Sparkles size={14} /> Draft steps
            </Button>
            <Button variant="quiet" onClick={() => setOpen(false)}>
              Close
            </Button>
          </>
        )}
      </div>
      <p className="text-[11px] leading-4 text-faint">
        {busy ? "Codex is reading the project folder. This can take a minute." : "Codex reads the project folder and suggests steps. Nothing runs until you press Run."}
      </p>
    </div>
  );
}
