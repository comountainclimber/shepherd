import { CircleX, LayoutGrid, Play, ScrollText, Settings, Square, UserRound, Users, Zap } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx, formatClock } from "../../model/format";
import { needsYou, progress } from "../../model/stage";
import { tasksForGoal } from "../../model/selectors";
import { pathFor } from "../../model/route";
import { agentStatus, runPlan, setWorkspacePath, stopPlan, workspacePath } from "../../runner/live";
import { clearWorkspace, initialFilters, useShepherd } from "../../store";

export function Hud() {
  const ui = useShepherd((store) => store.ui);
  const state = useShepherd((store) => store.state);
  const setView = useShepherd((store) => store.setView);
  const setFilters = useShepherd((store) => store.setFilters);
  const tasks = tasksForGoal(state, ui.goalId);
  const running = tasks.filter((task) => task.status === "running").length;
  const yours = tasks.filter((task) => needsYou(task, state.tasks, state.dependencies)).length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const filter = ui.filters;
  const toggle = (active: boolean, next: Partial<typeof filter>) => {
    setView("canvas");
    setFilters(active ? initialFilters : { ...initialFilters, ...next });
  };

  return (
    <header className="relative z-20 flex min-h-14 shrink-0 flex-wrap items-center gap-2 py-2 sm:flex-nowrap sm:gap-3 sm:py-0 border-b border-line bg-surface px-4">
      <div className="flex items-center gap-2">
        <Sheep size={26} />
        <span className="hidden md:inline text-[15px] font-semibold text-text">Shepherd</span>
      </div>
      <div className="flex items-center gap-1">
        <Counter
          icon={<Zap size={13} />}
          count={running}
          label="running"
          tone="text-running"
          active={filter.savedView === "running"}
          onClick={() => toggle(filter.savedView === "running", { savedView: "running" })}
        />
        <Counter
          icon={<UserRound size={13} />}
          count={yours}
          label={yours === 1 ? "needs you" : "need you"}
          tone="text-approval"
          active={filter.savedView === "needs-me"}
          onClick={() => toggle(filter.savedView === "needs-me", { savedView: "needs-me" })}
        />
        <Counter
          icon={<CircleX size={13} />}
          count={failed}
          label="failed"
          tone="text-failed"
          active={filter.status === "failed"}
          onClick={() => toggle(filter.status === "failed", { status: "failed" })}
        />
        <RunControl />
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        <div className="flex rounded-lg bg-black/25 p-0.5">
          <ViewButton active={ui.view === "canvas"} onClick={() => setView("canvas")} icon={<LayoutGrid size={14} />} label="Board" />
          <ViewButton active={ui.view === "agents"} onClick={() => setView("agents")} icon={<Users size={14} />} label="Agents" />
        </div>
        <Feed />
        <SettingsMenu />
      </div>
    </header>
  );
}

/** Runs or stops the focused graph's steps. Nothing shows before it has steps or once they are all done. */
function RunControl() {
  const goal = useShepherd((store) => store.state.goals.find((item) => item.id === store.ui.goalId));
  const allTasks = useShepherd((store) => store.state.tasks);
  const [busy, setBusy] = useState(false);
  const tasks = goal ? allTasks.filter((task) => task.goalId === goal.id) : [];
  if (!goal || !tasks.length) return null;
  const started = tasks.some((task) => task.status !== "queued" || task.git);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    await work();
    setBusy(false);
  };
  let button: ReactNode = null;
  if (goal.running) {
    button = (
      <button
        type="button"
        disabled={busy}
        onClick={() => void act(() => stopPlan(goal.id))}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface-2 px-3 text-[12px] font-medium text-text hover:bg-surface-3 disabled:opacity-50"
      >
        <Square size={11} /> Stop
      </button>
    );
  } else if (goal.status === "open" && !progress(tasks).complete) {
    button = (
      <button
        type="button"
        disabled={busy}
        onClick={() => void act(() => runPlan(goal.id))}
        title={`Run the steps of ${goal.name}`}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-transparent bg-brass px-3 text-[12px] font-medium text-ink hover:bg-brass-2 disabled:opacity-50"
      >
        <Play size={12} /> {started ? "Run the rest" : "Run"}
      </button>
    );
  }
  if (!button) return null;
  return (
    <>
      <span aria-hidden className="mx-1 h-[18px] w-px bg-white/10" />
      {button}
    </>
  );
}

function Counter({
  icon,
  count,
  label,
  tone,
  active,
  onClick,
}: {
  icon: ReactNode;
  count: number;
  label: string;
  tone: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? "Show every step" : `Show only steps that ${label}`}
      className={cx(
        "inline-flex h-8 items-center gap-1 sm:gap-1.5 rounded-lg border px-1 sm:px-2.5 text-[12px] transition-colors",
        count ? tone : "text-faint",
        active ? "border-current bg-current/10" : "border-transparent hover:bg-surface-2",
      )}
    >
      {icon}
      <span className="font-mono font-medium">{count}</span>
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

function ViewButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium",
        active ? "bg-surface-3 text-text" : "text-muted hover:text-text",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return { open, setOpen, ref };
}

const POPOVER = "enter absolute top-11 overflow-hidden rounded-lg border border-line-strong bg-surface shadow-2xl";

const FEED_TONE = { info: "bg-queued", success: "bg-completed", warning: "bg-running", failure: "bg-failed" } as const;

/** Everything that happened in the selected task, newest first. */
function Feed() {
  const { open, setOpen, ref } = usePopover();
  const goalId = useShepherd((store) => store.ui.goalId);
  const allEvents = useShepherd((store) => store.state.events);
  const notifications = useShepherd((store) => store.state.notifications);
  const dispatch = useShepherd((store) => store.dispatch);
  const selectTask = useShepherd((store) => store.selectTask);
  const steps = useShepherd((store) => store.state.tasks);
  const ids = new Set(steps.filter((step) => step.goalId === goalId).map((step) => step.id));
  const unread = notifications.filter((item) => !item.read && item.taskId && ids.has(item.taskId)).length;
  const events = allEvents.filter((event) => ids.has(event.taskId)).slice(-40).reverse();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Activity"
        title="Activity"
        onClick={() => {
          if (!open && unread) dispatch({ type: "readNotifications", goalId });
          setOpen(!open);
        }}
        className={cx("relative rounded-lg p-2 hover:bg-surface-2 hover:text-text", open ? "bg-surface-2 text-text" : "text-muted")}
      >
        <ScrollText size={17} />
        {unread ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-approval" /> : null}
      </button>
      {open ? (
        <div className={cx(POPOVER, "right-0 w-[min(384px,calc(100vw-24px))]")}>
          <div className="border-b border-line px-4 py-2.5 text-[13px] font-medium">Activity</div>
          <ol className="max-h-[60vh] overflow-auto p-1">
            {events.map((event) => (
              <li key={event.id}>
                <a
                  href={pathFor({ goalId, view: "canvas", stepId: event.taskId, tab: "step" })}
                  onClick={(click) => {
                    if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return;
                    click.preventDefault();
                    selectTask(event.taskId);
                    setOpen(false);
                  }}
                  className="flex w-full gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-surface-2"
                >
                  <span className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", FEED_TONE[event.tone])} />
                  <span className="min-w-0 flex-1 text-[12px] leading-5 text-text">{event.message}</span>
                  <span className="shrink-0 font-mono text-[10px] leading-5 text-faint">{formatClock(event.at)}</span>
                </a>
              </li>
            ))}
            {!events.length ? <li className="px-3 py-2 text-[13px] text-faint">Nothing yet.</li> : null}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function SettingsMenu() {
  const { open, setOpen, ref } = usePopover();
  const saved = useShepherd((store) => store.state.workspace ?? "");
  const requestDraft = useShepherd((store) => store.requestDraft);
  const setPaletteOpen = useShepherd((store) => store.setPaletteOpen);
  const [folder, setFolder] = useState(saved);
  const [status, setStatus] = useState<{ claude: boolean; codex: boolean; git: boolean; workspace: string } | null>(null);

  useEffect(() => setFolder(saved), [saved]);
  useEffect(() => {
    if (!open) return;
    agentStatus()
      .then(setStatus)
      .catch(() => setStatus({ claude: false, codex: false, git: false, workspace: "" }));
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Settings"
        onClick={() => setOpen(!open)}
        className={cx("rounded-lg p-2 hover:bg-surface-2 hover:text-text", open ? "bg-surface-2 text-text" : "text-muted")}
      >
        <Settings size={17} />
      </button>
      {open ? (
        <div className={cx(POPOVER, "right-0 w-80 space-y-3 p-4")}>
          <div>
            <div className="mb-1 text-[12px] text-muted">Agents</div>
            {status ? (
              <div className="flex gap-2 text-[12px]">
                <Online label="Codex" on={status.codex} />
                <Online label="Claude" on={status.claude} />
                {!status.git ? <span className="text-failed">git is missing</span> : null}
              </div>
            ) : (
              <div className="text-[12px] text-faint">Checking…</div>
            )}
          </div>
          <label className="block">
            <span className="mb-1 block text-[12px] text-muted">Folder that holds every project</span>
            <input
              value={folder}
              placeholder={status?.workspace || ".agent-sandbox"}
              onChange={(event) => setFolder(event.target.value)}
              onBlur={() => folder.trim() !== saved && setWorkspacePath(folder)}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              className="h-8 w-full rounded-lg border border-line-strong bg-black/20 px-3 font-mono text-[11px] text-text outline-none placeholder:text-faint focus:border-brass"
            />
            <span className="mt-1 block text-[11px] text-faint">{workspacePath() ? "Saved on the server." : "Empty uses the default shown."}</span>
          </label>
          <div className="flex flex-col border-t border-line pt-2">
            <MenuLink
              label="Draft steps from a goal"
              onClick={() => {
                requestDraft();
                setOpen(false);
              }}
            />
            <MenuLink
              label="All commands (⌘K)"
              onClick={() => {
                setPaletteOpen(true);
                setOpen(false);
              }}
            />
            <MenuLink danger label="Clear the whole board" onClick={clearWorkspace} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Online({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5", on ? "bg-completed/15 text-completed" : "bg-white/5 text-faint")}>
      <span className={cx("h-1.5 w-1.5 rounded-full", on ? "bg-completed" : "bg-faint")} />
      {label} {on ? "ready" : "signed out"}
    </span>
  );
}

function MenuLink({ label, onClick, danger = false }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx("rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2", danger ? "text-failed" : "text-text")}
    >
      {label}
    </button>
  );
}

/** Matches the length of the walk in index.css: five steps of half a second. */
const WALK_MS = 2_500;

/** Now and then, and when you point at it, the sheep takes a few steps. */
function useWalking(): [boolean, () => void] {
  const [walking, setWalking] = useState(false);
  const walk = useRef<() => void>(() => {});
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    let busy = false;
    const rest = () => {
      timer = window.setTimeout(() => walk.current(), 20_000 + Math.random() * 40_000);
    };
    walk.current = () => {
      if (busy) return;
      window.clearTimeout(timer);
      if (document.hidden) return rest();
      busy = true;
      setWalking(true);
      timer = window.setTimeout(() => {
        busy = false;
        setWalking(false);
        rest();
      }, WALK_MS);
    };
    rest();
    return () => window.clearTimeout(timer);
  }, []);
  return [walking, () => walk.current()];
}

/** Shepherd's logo. */
export function Sheep({ size = 34 }: { size?: number }) {
  const [walking, walk] = useWalking();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={cx("sheep", walking && "walking")} onMouseEnter={walk}>
      <rect className="leg leg-a" x="18" y="21" width="2.6" height="6" rx="1.2" fill="#2a2f38" />
      <rect className="leg leg-b" x="10.5" y="21" width="2.6" height="6" rx="1.2" fill="#2a2f38" />
      <rect className="leg leg-a" x="10.5" y="21" width="2.6" height="6" rx="1.2" fill="#3a404c" />
      <rect className="leg leg-b" x="18" y="21" width="2.6" height="6" rx="1.2" fill="#3a404c" />
      <g className="sheep-body">
        <g fill="#e9ebf0">
          <circle cx="11" cy="15" r="6" />
          <circle cx="17" cy="12.5" r="6" />
          <circle cx="21.5" cy="17" r="5" />
          <circle cx="15" cy="19" r="5" />
          <circle cx="7.5" cy="18.5" r="4" />
        </g>
        <g className="sheep-head">
          <ellipse cx="25.5" cy="12.5" rx="4.2" ry="3.6" fill="#3a404c" />
          <ellipse cx="23" cy="9.8" rx="1.8" ry="1" fill="#3a404c" transform="rotate(-30 23 9.8)" />
          <circle cx="26.7" cy="11.8" r="1" fill="#fff" />
          <circle cx="27" cy="11.6" r="0.45" fill="#0f1115" />
        </g>
      </g>
    </svg>
  );
}
