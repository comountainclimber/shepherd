import { Archive, Check, ChevronDown, ChevronRight, ChevronUp, CircleCheck, Copy, Ellipsis, ExternalLink, FilePen, Folder, FolderGit2, FolderOpen, GitMerge, Pencil, RotateCcw, Terminal, Trash2, Workflow } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { create } from "zustand";
import { blankGoal } from "../../model/factory";
import { cx } from "../../model/format";
import { GRAPH_COLORS, archivedGraphsOf, colorForNewGraph, graphColor, graphsOf, nextColor, objectivesOf, tint } from "../../model/graphs";
import { outlineOf } from "../../model/outline";
import { stageOf } from "../../model/stage";
import type { Goal, Objective, OrchestrationState, Project, UiState } from "../../model/types";
import { useShepherd } from "../../store";
import { copyFolder, mergeable, openFolder, useGraphDialog } from "./GraphActions";
import { GraphSteps } from "./Steps";

const FOCUS = "outline-none focus-visible:shadow-[inset_0_0_0_1px_rgba(242,181,68,.6)]";
const TREE_KEY = "shepherd.tree";

/** Which repos are open and which graphs show their steps. Kept per browser. */
interface TreeOpen {
  repos: Record<string, boolean>;
  graphs: Record<string, boolean>;
}

function savedTree(): TreeOpen {
  try {
    const saved = JSON.parse(localStorage.getItem(TREE_KEY) ?? "{}") as Partial<TreeOpen>;
    return { repos: saved.repos ?? {}, graphs: saved.graphs ?? {} };
  } catch {
    return { repos: {}, graphs: {} };
  }
}

interface TreeStore extends TreeOpen {
  /** The row whose ⋯ menu is open, as `objective:<id>` or `graph:<id>`. */
  menu: string;
  /** The row being renamed, keyed the same way. */
  editing: string;
  setRepo: (id: string, open: boolean) => void;
  setGraph: (id: string, open: boolean) => void;
  setMenu: (key: string) => void;
  setEditing: (key: string) => void;
}

export const useTree = create<TreeStore>()((set) => ({
  ...(typeof localStorage === "undefined" ? { repos: {}, graphs: {} } : savedTree()),
  menu: "",
  editing: "",
  setRepo: (id, open) => set((tree) => ({ repos: { ...tree.repos, [id]: open } })),
  setGraph: (id, open) => set((tree) => ({ graphs: { ...tree.graphs, [id]: open } })),
  setMenu: (menu) => set({ menu }),
  setEditing: (editing) => set({ editing, menu: "" }),
}));

if (typeof localStorage !== "undefined") {
  useTree.subscribe((tree, before) => {
    if (tree.repos === before.repos && tree.graphs === before.graphs) return;
    try {
      localStorage.setItem(TREE_KEY, JSON.stringify({ repos: tree.repos, graphs: tree.graphs }));
    } catch {
      // Private windows can refuse storage; the tree still works for this visit.
    }
  });
}

/** A repo is open when you opened it, or when the picked objective is in it. */
export function repoOpen(tree: TreeOpen, ui: UiState, projectId: string): boolean {
  return tree.repos[projectId] === true || (projectId === ui.projectId && !!ui.objectiveId);
}

/** The repo that "New objective" adds to: the picked objective's, or the first open one. */
export function currentRepo(state: OrchestrationState, tree: TreeOpen, ui: UiState): Project | undefined {
  if (ui.objectiveId) return state.projects.find((project) => project.id === ui.projectId);
  return state.projects.find((project) => repoOpen(tree, ui, project.id));
}

/** The step row the saved-step picker opens under, or null when it opens at the end of the graph. */
export function pickerRow(state: OrchestrationState, ui: UiState): string | null {
  const place = ui.addSaved;
  if (!place) return null;
  return place.replace ?? (place.after !== outlineOf(state, ui.goalId).at(-1)?.id ? place.after : null);
}

/** Makes an objective in a repo, picks it and puts its name up for editing. */
export function newObjective(projectId: string) {
  const store = useShepherd.getState();
  const id = `objective-${crypto.randomUUID()}`;
  store.dispatch({ type: "createObjective", objective: { id, projectId, name: "Untitled objective" } });
  store.setObjective(id);
  store.setView("canvas");
  useTree.getState().setEditing(`objective:${id}`);
}

/** Makes a graph in an objective, in the next colour, and focuses it. */
export function newGraph(objective: Objective, rename = true): string {
  const store = useShepherd.getState();
  const id = `goal-${crypto.randomUUID()}`;
  const color = colorForNewGraph(store.state, objective.id);
  store.dispatch({ type: "createGoal", goal: { ...blankGoal(objective.projectId, "Untitled graph", id), objectiveId: objective.id, color } });
  store.setGoal(id);
  store.setView("canvas");
  const tree = useTree.getState();
  tree.setGraph(id, true);
  if (rename) tree.setEditing(`graph:${id}`);
  else tree.setMenu("");
  return id;
}

export function moveGraph(goalId: string, by: -1 | 1) {
  useShepherd.getState().dispatch({ type: "moveGoal", id: goalId, by });
}

function running(state: OrchestrationState, goalIds: string[]): boolean {
  return state.tasks.some((task) => goalIds.includes(task.goalId) && task.status === "running");
}

export type Indicator = "done" | "active" | null;

/** Done when every step is verified; active once any step is running, needs you or failed. */
export function indicatorFor(state: OrchestrationState, goalIds: string[]): Indicator {
  const steps = state.tasks.filter((task) => goalIds.includes(task.goalId));
  if (!steps.length) return null;
  const stages = steps.map((task) => stageOf(task, state.tasks, state.dependencies));
  if (stages.every((stage) => stage === "verified")) return "done";
  const busy = stages.some((stage) => stage === "running" || stage === "checking" || stage === "updating" || stage === "needs-you" || stage === "failed");
  return busy ? "active" : null;
}

function activate(run: () => void) {
  return (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      run();
    }
  };
}

/** Workspace → repo → objective → graph → step, as one list. */
export function Tree() {
  const projects = useShepherd((store) => store.state.projects);
  const setNewProjectOpen = useShepherd((store) => store.setNewProjectOpen);
  const repos = projects.filter((project) => project.repo);
  const folders = projects.filter((project) => !project.repo);
  return (
    <ol className="flex flex-col" aria-label="Repos, objectives and graphs">
      <Section label="Your repos" count={repos.length} hint="Git repositories on your disk. Each graph works on its own branch and worktree of the repo." first />
      {repos.length ? (
        repos.map((project, index) => <RepoBranch key={project.id} project={project} first={index === 0} />)
      ) : (
        <li className="px-1.5 py-1.5 text-[12px] leading-5 text-faint">
          No repos yet.{" "}
          <button type="button" onClick={() => setNewProjectOpen(true)} className="text-brass hover:underline">
            Add a repo…
          </button>
        </li>
      )}
      {folders.length ? (
        <>
          <Section label="Shepherd folders" count={folders.length} hint="Folders Shepherd made in its own workspace, for trying things out. None of these is one of your repos." />
          {folders.map((project, index) => (
            <RepoBranch key={project.id} project={project} first={index === 0} />
          ))}
        </>
      ) : null}
    </ol>
  );
}

/** A label over one kind of project, so a real repo never looks like a folder Shepherd made. */
function Section({ label, count, hint, first = false }: { label: string; count: number; hint: string; first?: boolean }) {
  return (
    <li role="presentation" title={hint} className={cx("flex items-center gap-2 px-1.5 pb-1 text-[11px] font-medium text-faint", first ? "pt-0.5" : "pt-4")}>
      <span>{label}</span>
      <span className="font-mono">{count}</span>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </li>
  );
}

/** A repo's path with the home folder as ~. */
function shortPath(path: string): string {
  return path.replace(/^\/(Users|home)\/[^/]+/, "~");
}

function RepoBranch({ project, first }: { project: Project; first: boolean }) {
  const state = useShepherd((store) => store.state);
  const ui = useShepherd((store) => store.ui);
  const clearSelection = useShepherd((store) => store.clearSelection);
  const tree = useTree();
  const open = repoOpen(tree, ui, project.id);
  const objectives = objectivesOf(state, project.id);
  const archived = state.objectives.filter((objective) => objective.projectId === project.id && objective.archived);
  const toggle = () => {
    // Folding away the picked objective lets go of it.
    if (open && ui.projectId === project.id && ui.objectiveId) clearSelection();
    tree.setRepo(project.id, !open);
  };
  return (
    <>
      <li
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={activate(toggle)}
        title={project.repo ? `Repo: ${project.repo}` : `Shepherd folder: ${project.directory ?? project.name}, in Shepherd's workspace`}
        className={cx("flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-lg px-1.5 hover:bg-surface-2", FOCUS, !first && "mt-2")}
      >
        <ChevronRight size={12} className={cx("shrink-0 text-faint transition-transform duration-150", open && "rotate-90")} />
        {project.repo ? <FolderGit2 size={14} className="shrink-0 text-text" /> : <Folder size={14} className="shrink-0 text-faint" />}
        <span className={cx("min-w-0 truncate text-[13px] font-semibold", !project.repo && "flex-1")}>{project.name}</span>
        {project.repo ? <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">{shortPath(project.repo)}</span> : null}
        <span className="font-mono text-[11px] text-faint">{objectives.length}</span>
      </li>
      {open ? objectives.map((objective) => <ObjectiveBranch key={objective.id} objective={objective} />) : null}
      {open && archived.length ? <ArchivedObjectives objectives={archived} /> : null}
    </>
  );
}

function ObjectiveBranch({ objective }: { objective: Objective }) {
  const state = useShepherd((store) => store.state);
  const ui = useShepherd((store) => store.ui);
  const dispatch = useShepherd((store) => store.dispatch);
  const setObjective = useShepherd((store) => store.setObjective);
  const clearSelection = useShepherd((store) => store.clearSelection);
  const { menu, editing, setMenu, setEditing } = useTree();
  const key = `objective:${objective.id}`;
  const selected = ui.objectiveId === objective.id;
  const graphs = graphsOf(state, objective.id);
  const archived = archivedGraphsOf(state, objective.id);
  const menuOpen = menu === key;
  const select = () => {
    if (!selected) setObjective(objective.id);
    setMenu("");
  };
  const archive = () => {
    const ids = graphs.map((goal) => goal.id);
    if (running(state, ids) && !window.confirm(`Archive “${objective.name}”? Its running steps stop.`)) return;
    dispatch({ type: "archiveObjective", id: objective.id });
    if (selected) clearSelection();
    setMenu("");
  };
  return (
    <>
      <li
        tabIndex={0}
        aria-selected={selected}
        onClick={select}
        onKeyDown={activate(() => (selected ? setEditing(key) : select()))}
        onContextMenu={openMenu(key, menuOpen, setMenu)}
        className={cx(
          "group relative flex h-8 cursor-pointer select-none items-center gap-1.5 rounded-lg pl-[22px] pr-1.5",
          FOCUS,
          selected ? "bg-surface-3" : "hover:bg-surface-2",
        )}
      >
        <span aria-hidden className="absolute inset-y-0 left-[13px] w-px bg-white/12" />
        <ChevronRight size={12} className={cx("shrink-0 text-faint transition-transform duration-150", selected && "rotate-90")} />
        {editing === key ? (
          <Rename initial={objective.name} onCommit={(name) => dispatch({ type: "updateObjective", id: objective.id, patch: { name } })} />
        ) : (
          <span className={cx("min-w-0 flex-1 truncate text-[13px]", selected ? "font-semibold text-text" : "font-medium text-muted")}>{objective.name}</span>
        )}
        <Mark value={indicatorFor(state, graphs.map((goal) => goal.id))} />
        <span className="font-mono text-[11px] text-faint">{graphs.length}</span>
        <MenuButton open={menuOpen} shown={selected} label={`More for ${objective.name}`} onClick={openMenu(key, menuOpen, setMenu)} />
        {menuOpen ? (
          <Menu>
            <MenuItem icon={<Pencil size={14} />} label="Rename" hint="↵" onClick={() => setEditing(key)} />
            <MenuItem
              icon={<Workflow size={14} />}
              label="New graph"
              onClick={() => {
                if (!selected) setObjective(objective.id);
                newGraph(objective);
              }}
            />
            <MenuDivider />
            <MenuItem icon={<Archive size={14} />} label="Archive objective" onClick={archive} />
          </Menu>
        ) : null}
      </li>
      {selected ? (
        <>
          {graphs.map((goal, index) => (
            <GraphBranch key={goal.id} goal={goal} index={index} last={index === graphs.length - 1} />
          ))}
          {archived.length ? <ArchivedGraphs graphs={archived} /> : null}
        </>
      ) : null}
    </>
  );
}

function GraphBranch({ goal, index, last }: { goal: Goal; index: number; last: boolean }) {
  const state = useShepherd((store) => store.state);
  const ui = useShepherd((store) => store.ui);
  const dispatch = useShepherd((store) => store.dispatch);
  const setGoal = useShepherd((store) => store.setGoal);
  const setObjective = useShepherd((store) => store.setObjective);
  const { menu, editing, graphs: openGraphs, setMenu, setEditing, setGraph } = useTree();
  const openDialog = useGraphDialog((store) => store.open);
  const key = `graph:${goal.id}`;
  const focused = ui.goalId === goal.id;
  const color = graphColor(goal);
  const open = openGraphs[goal.id] !== false;
  const menuOpen = menu === key;
  const gap = index > 0 ? 6 : 0;
  const focus = () => {
    if (!focused) setGoal(goal.id);
    setGraph(goal.id, true);
    setMenu("");
  };
  /** Runs a menu choice and closes the menu. */
  const pick = (run: () => void) => () => {
    setMenu("");
    run();
  };
  const ready = mergeable(state, goal);
  const archive = () => {
    if (running(state, [goal.id]) && !window.confirm(`Archive “${goal.name}”? Its running steps stop.`)) return;
    dispatch({ type: "archiveGoal", id: goal.id });
    if (focused && goal.objectiveId) setObjective(goal.objectiveId);
    setMenu("");
  };
  return (
    <>
      <li
        tabIndex={0}
        aria-selected={focused}
        aria-expanded={open}
        onKeyDown={activate(() => (focused ? setEditing(key) : focus()))}
        onContextMenu={openMenu(key, menuOpen, setMenu)}
        className={cx("group relative flex h-[30px] select-none items-center gap-2 rounded-lg pl-[38px] pr-1.5", FOCUS, !focused && "hover:bg-surface-2")}
        style={{ marginTop: gap, background: focused ? tint(color, 12) : undefined }}
      >
        <span aria-hidden className="absolute bottom-0 left-[13px] w-px bg-white/12" style={{ top: -gap }} />
        <span aria-hidden className="absolute bottom-0 left-[29px] w-px bg-white/12" style={{ top: -gap }} />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? `Hide the steps of ${goal.name}` : `Show the steps of ${goal.name}`}
          onClick={() => setGraph(goal.id, !open)}
          className="-mx-1 inline-flex h-5 w-4 shrink-0 items-center justify-center text-faint hover:text-text"
        >
          <ChevronRight size={12} className={cx("transition-transform duration-150", open && "rotate-90")} />
        </button>
        <span onClick={focus} className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2">
          <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />
          {editing === key ? (
            <Rename small initial={goal.name} onCommit={(name) => dispatch({ type: "updateGoal", id: goal.id, patch: { name } })} />
          ) : (
            <span title={goal.goal || undefined} className={cx("min-w-0 flex-1 truncate text-[12px] font-semibold", focused ? "text-text" : "text-muted")}>{goal.name}</span>
          )}
        </span>
        <Mark value={indicatorFor(state, [goal.id])} />
        <MenuButton open={menuOpen} shown={focused} label={`More for ${goal.name}`} onClick={openMenu(key, menuOpen, setMenu)} />
        {menuOpen ? (
          <Menu>
            <MenuItem icon={<Pencil size={14} />} label="Rename" hint="↵" onClick={() => setEditing(key)} />
            <MenuItem icon={<FilePen size={14} />} label="Edit name and goal…" onClick={pick(() => openDialog({ kind: "edit", goalId: goal.id }))} />
            <MenuItem
              icon={
                <span aria-hidden className="grid w-3.5 grid-cols-2 gap-[3px]">
                  {GRAPH_COLORS.slice(0, 4).map((swatch) => (
                    <span key={swatch} className="size-[5px] rounded-[1px]" style={{ background: swatch }} />
                  ))}
                </span>
              }
              label="Color"
              trailing={<span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: nextColor(goal.color) }} />}
              onClick={() => dispatch({ type: "updateGoal", id: goal.id, patch: { color: nextColor(goal.color) } })}
            />
            <MenuDivider />
            <MenuItem
              icon={<GitMerge size={14} />}
              label={`Merge into ${goal.base ?? "base"}…`}
              disabled={!ready}
              title={ready ? undefined : "Merging needs a branch, every step done with its checks passed, and nothing left to collect."}
              onClick={pick(() => openDialog({ kind: "merge", goalId: goal.id }))}
            />
            {goal.status === "open" ? (
              <MenuItem icon={<CircleCheck size={14} />} label="Mark done" onClick={pick(() => dispatch({ type: "finishGoal", id: goal.id }))} />
            ) : (
              <MenuItem icon={<RotateCcw size={14} />} label="Reopen" onClick={pick(() => dispatch({ type: "reopenGoal", id: goal.id }))} />
            )}
            {goal.mergeRequestUrl ? (
              <MenuItem icon={<ExternalLink size={14} />} label="Open merge request" onClick={pick(() => window.open(goal.mergeRequestUrl, "_blank", "noopener,noreferrer"))} />
            ) : null}
            {goal.folder ? (
              <>
                <MenuDivider />
                <MenuItem icon={<Terminal size={14} />} label="Open in Cursor" onClick={pick(() => openFolder(goal, "cursor"))} />
                <MenuItem icon={<FolderOpen size={14} />} label="Open in Finder" onClick={pick(() => openFolder(goal, "finder"))} />
                <MenuItem icon={<Copy size={14} />} label="Copy folder path" onClick={pick(() => void copyFolder(goal))} />
              </>
            ) : null}
            <MenuDivider />
            <MenuItem icon={<ChevronUp size={14} />} label="Move up" hint="⌥↑" disabled={index === 0} onClick={() => moveGraph(goal.id, -1)} />
            <MenuItem icon={<ChevronDown size={14} />} label="Move down" hint="⌥↓" disabled={last} onClick={() => moveGraph(goal.id, 1)} />
            <MenuDivider />
            <MenuItem icon={<Archive size={14} />} label="Archive graph" onClick={archive} />
            <MenuItem icon={<Trash2 size={14} />} label="Delete graph…" danger onClick={pick(() => openDialog({ kind: "delete", goalId: goal.id }))} />
          </Menu>
        ) : null}
      </li>
      {open ? <GraphSteps goal={goal} color={color} pickerUnder={focused ? pickerRow(state, ui) : null} /> : null}
    </>
  );
}

function ArchivedGraphs({ graphs }: { graphs: Goal[] }) {
  const dispatch = useShepherd((store) => store.dispatch);
  const setGraph = useTree((tree) => tree.setGraph);
  return (
    <ArchivedList
      guides={[13, 29]}
      inset={38}
      items={graphs.map((goal) => ({ id: goal.id, name: goal.name, color: graphColor(goal) }))}
      onRestore={(id) => {
        dispatch({ type: "reopenGoal", id });
        setGraph(id, true);
      }}
    />
  );
}

function ArchivedObjectives({ objectives }: { objectives: Objective[] }) {
  const dispatch = useShepherd((store) => store.dispatch);
  const setObjective = useShepherd((store) => store.setObjective);
  return (
    <ArchivedList
      guides={[13]}
      inset={22}
      items={objectives}
      onRestore={(id) => {
        dispatch({ type: "restoreObjective", id });
        setObjective(id);
      }}
    />
  );
}

/** An "Archived" row that opens to what was archived at this level, each with Restore. */
function ArchivedList({ guides, inset, items, onRestore }: { guides: number[]; inset: number; items: { id: string; name: string; color?: string }[]; onRestore: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const lines = guides.map((left) => <span key={left} aria-hidden className="absolute inset-y-0 w-px bg-white/12" style={{ left }} />);
  return (
    <>
      <li
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={activate(() => setOpen(!open))}
        className={cx("relative mt-1 flex h-7 cursor-pointer select-none items-center gap-2 rounded-lg pr-1.5 text-[12px] text-faint hover:text-muted", FOCUS)}
        style={{ paddingLeft: inset }}
      >
        {lines}
        <ChevronRight size={12} className={cx("shrink-0 transition-transform duration-150", open && "rotate-90")} />
        <Archive size={12} className="shrink-0" />
        <span className="flex-1">Archived</span>
        <span className="font-mono text-[11px]">{items.length}</span>
      </li>
      {open
        ? items.map((item) => (
            <li key={item.id} className="relative flex h-7 items-center gap-2 pr-1.5 text-[12px] text-muted" style={{ paddingLeft: inset + 18 }}>
              {lines}
              {item.color ? <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] opacity-50" style={{ background: item.color }} /> : null}
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <button type="button" onClick={() => onRestore(item.id)} className="text-[11px] text-faint hover:text-text">
                Restore
              </button>
            </li>
          ))
        : null}
    </>
  );
}

/** A pulsing dot while work in it is under way, a check once every step is verified. */
function Mark({ value }: { value: Indicator }) {
  if (value === "active") return <span aria-label="In progress" className="beat size-[7px] shrink-0 rounded-full bg-running" />;
  if (value === "done") return <Check aria-label="Done" size={13} strokeWidth={2.5} className="shrink-0 text-completed" />;
  return null;
}

function openMenu(key: string, open: boolean, setMenu: (key: string) => void) {
  return (event: MouseEvent) => {
    event.stopPropagation();
    if (event.type === "contextmenu") {
      event.preventDefault();
      setMenu(key);
    } else setMenu(open ? "" : key);
  };
}

function MenuButton({ open, shown, label, onClick }: { open: boolean; shown: boolean; label: string; onClick: (event: MouseEvent) => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onClick}
      className={cx(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-[5px] transition-opacity duration-100 hover:text-text hover:opacity-100 group-hover:opacity-100 group-focus-visible:opacity-100",
        open ? "bg-surface-3 text-text opacity-100" : shown ? "text-faint opacity-100" : "text-faint opacity-35",
      )}
    >
      <Ellipsis size={14} />
    </button>
  );
}

const MENU_WIDTH = 196;

/** A row's menu, floating under the row (or above it near the bottom) so the sidebar never clips it. */
function Menu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ top: 0, left: 0, visibility: "hidden" });
  useLayoutEffect(() => {
    const menu = ref.current;
    const row = menu?.parentElement;
    if (!menu || !row) return;
    const box = row.getBoundingClientRect();
    const below = box.bottom + 4;
    const top = below + menu.offsetHeight > window.innerHeight - 8 ? Math.max(8, box.top - menu.offsetHeight - 4) : below;
    setPlace({ top, left: Math.max(8, box.right - 6 - MENU_WIDTH) });
  }, []);
  return (
    <div
      ref={ref}
      role="menu"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      className="fixed z-40 flex flex-col gap-0.5 rounded-[10px] border border-white/10 bg-surface-2 p-1 font-normal text-text shadow-[0_20px_40px_-10px_rgba(0,0,0,.6)]"
      style={{ ...place, width: MENU_WIDTH }}
    >
      {children}
    </div>
  );
}

function MenuItem({ icon, label, hint, trailing, disabled, danger = false, title, onClick }: { icon: ReactNode; label: string; hint?: string; trailing?: ReactNode; disabled?: boolean; danger?: boolean; title?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cx("flex h-[30px] items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-transparent", danger && "text-failed")}
    >
      <span className={cx("inline-flex w-3.5 shrink-0 justify-center", danger ? "text-failed" : "text-muted")}>{icon}</span>
      <span className="flex-1">{label}</span>
      {hint ? <span className="font-mono text-[11px] text-faint">{hint}</span> : null}
      {trailing}
    </button>
  );
}

function MenuDivider() {
  return <div aria-hidden className="mx-1 my-0.5 h-px bg-line" />;
}

/** The name as a box: Enter or leaving it keeps the new name, Escape keeps the old one. */
function Rename({ initial, small = false, onCommit }: { initial: string; small?: boolean; onCommit: (name: string) => void }) {
  const setEditing = useTree((tree) => tree.setEditing);
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing("");
    const name = value.trim();
    if (keep && name && name !== initial) onCommit(name);
  };
  return (
    <input
      autoFocus
      value={value}
      aria-label="Name"
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(true);
        else if (event.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      className={cx(
        "min-w-0 flex-1 rounded-md border border-brass bg-black/30 font-semibold text-text shadow-[0_0_0_2px_rgba(242,181,68,.2)] outline-none",
        small ? "h-[22px] px-1.5 text-[12px]" : "h-6 px-2 text-[13px]",
      )}
    />
  );
}
