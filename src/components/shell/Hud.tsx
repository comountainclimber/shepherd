import { ChevronDown, CircleX, LayoutGrid, Plus, ScrollText, Settings, UserRound, Users, Zap } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx, formatClock } from "../../model/format";
import { needsYou, progress } from "../../model/stage";
import { tasksForProject } from "../../model/selectors";
import { agentStatus, setWorkspacePath, workspacePath } from "../../runner/live";
import { clearWorkspace, initialFilters, useShepherd } from "../../store";

export function Hud() {
  const ui = useShepherd((store) => store.ui);
  const state = useShepherd((store) => store.state);
  const setView = useShepherd((store) => store.setView);
  const setFilters = useShepherd((store) => store.setFilters);
  const tasks = tasksForProject(state, ui.projectId);
  const running = tasks.filter((task) => task.status === "running").length;
  const yours = tasks.filter((task) => needsYou(task, state.tasks, state.dependencies)).length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const filter = ui.filters;
  const toggle = (active: boolean, next: Partial<typeof filter>) => {
    setView("canvas");
    setFilters(active ? initialFilters : { ...initialFilters, ...next });
  };

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <div className="flex items-center gap-2">
        <Sheep size={26} />
        <span className="text-[15px] font-semibold text-text">Shepherd</span>
      </div>
      <ProjectPicker />
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
      title={active ? "Show every task" : `Show only tasks that ${label}`}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] transition-colors",
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

function ProjectPicker() {
  const state = useShepherd((store) => store.state);
  const projectId = useShepherd((store) => store.ui.projectId);
  const setProject = useShepherd((store) => store.setProject);
  const setNewProjectOpen = useShepherd((store) => store.setNewProjectOpen);
  const { open, setOpen, ref } = usePopover();
  const current = state.projects.find((project) => project.id === projectId);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex h-8 max-w-[240px] items-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-3 hover:bg-surface-3"
      >
        <span className="truncate text-[13px] font-medium">{current?.name ?? "Pick a project"}</span>
        <ChevronDown size={14} className="shrink-0 text-muted" />
      </button>
      {open ? (
        <div className={cx(POPOVER, "left-0 w-72 p-1")}>
          {state.projects.map((project) => {
            const score = progress(state.tasks.filter((task) => task.projectId === project.id));
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => {
                  setProject(project.id);
                  setOpen(false);
                }}
                className={cx(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left",
                  project.id === projectId ? "bg-surface-3" : "hover:bg-surface-2",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{project.name}</span>
                <span className={cx("font-mono text-[11px]", score.complete ? "text-completed" : "text-faint")}>
                  {score.total ? `${score.done}/${score.total}` : "empty"}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setNewProjectOpen(true);
              setOpen(false);
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-line px-3 py-2 text-left text-[13px] text-brass hover:bg-surface-2"
          >
            <Plus size={14} /> New project
          </button>
        </div>
      ) : null}
    </div>
  );
}

const FEED_TONE = { info: "bg-queued", success: "bg-completed", warning: "bg-running", failure: "bg-failed" } as const;

/** Everything that happened in this project, newest first. */
function Feed() {
  const { open, setOpen, ref } = usePopover();
  const projectId = useShepherd((store) => store.ui.projectId);
  const allEvents = useShepherd((store) => store.state.events);
  const unread = useShepherd((store) => store.state.notifications.filter((item) => !item.read).length);
  const dispatch = useShepherd((store) => store.dispatch);
  const selectTask = useShepherd((store) => store.selectTask);
  const events = allEvents.filter((event) => event.projectId === projectId).slice(-40).reverse();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Activity"
        title="Activity"
        onClick={() => {
          if (!open && unread) dispatch({ type: "readNotifications" });
          setOpen(!open);
        }}
        className={cx("relative rounded-lg p-2 hover:bg-surface-2 hover:text-text", open ? "bg-surface-2 text-text" : "text-muted")}
      >
        <ScrollText size={17} />
        {unread ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-approval" /> : null}
      </button>
      {open ? (
        <div className={cx(POPOVER, "right-0 w-96")}>
          <div className="border-b border-line px-4 py-2.5 text-[13px] font-medium">Activity</div>
          <ol className="max-h-[60vh] overflow-auto p-1">
            {events.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => {
                    selectTask(event.taskId);
                    setOpen(false);
                  }}
                  className="flex w-full gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-surface-2"
                >
                  <span className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", FEED_TONE[event.tone])} />
                  <span className="min-w-0 flex-1 text-[12px] leading-5 text-text">{event.message}</span>
                  <span className="shrink-0 font-mono text-[10px] leading-5 text-faint">{formatClock(event.at)}</span>
                </button>
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

/** Shepherd's logo. */
export function Sheep({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="10.5" y="21" width="2.6" height="6" rx="1.2" fill="#3a404c" />
      <rect x="18" y="21" width="2.6" height="6" rx="1.2" fill="#3a404c" />
      <g fill="#e9ebf0">
        <circle cx="11" cy="15" r="6" />
        <circle cx="17" cy="12.5" r="6" />
        <circle cx="21.5" cy="17" r="5" />
        <circle cx="15" cy="19" r="5" />
        <circle cx="7.5" cy="18.5" r="4" />
      </g>
      <ellipse cx="25.5" cy="12.5" rx="4.2" ry="3.6" fill="#3a404c" />
      <ellipse cx="23" cy="9.8" rx="1.8" ry="1" fill="#3a404c" transform="rotate(-30 23 9.8)" />
      <circle cx="26.7" cy="11.8" r="1" fill="#fff" />
      <circle cx="27" cy="11.6" r="0.45" fill="#0f1115" />
    </svg>
  );
}
