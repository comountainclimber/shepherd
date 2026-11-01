import { ChevronDown, FolderGit2, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "../../model/format";
import { goalSummary } from "../../model/goals";
import type { Goal } from "../../model/types";
import { useShepherd } from "../../store";

export function ProjectSwitcher() {
  const { state, ui, setGoal, setProject, setNewProjectOpen, setNewTaskProject } = useShepherd();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const project = state.projects.find((project) => project.id === ui.projectId);
  const selected = state.goals.find((goal) => goal.id === ui.goalId);
  useEffect(() => {
    if (!open) return;
    const click = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", click);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", click);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  const row = (goal: Goal) => {
    const summary = goalSummary(state, goal);
    return (
      <button
        key={goal.id}
        type="button"
        aria-current={goal.id === ui.goalId ? "page" : undefined}
        onClick={() => {
          setGoal(goal.id);
          setOpen(false);
        }}
        className={cx("block w-full rounded-lg px-3 py-2 text-left", goal.id === ui.goalId ? "bg-surface-3" : "hover:bg-surface-2")}
      >
        <span className="block truncate text-[13px] font-medium">{goal.name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-faint">
          <span>
            {summary.done}/{summary.total} steps done
          </span>
          {goal.status !== "open" ? (
            <span>{goal.status === "done" ? "Done" : "Archived"}</span>
          ) : (
            <>
              {summary.running ? <span className="text-running">Running</span> : null}
              {summary.needsYou ? <span className="text-approval">Needs you</span> : null}
              {!summary.running && !summary.needsYou ? <span>Open</span> : null}
            </>
          )}
        </span>
      </button>
    );
  };
  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        aria-label="Projects and tasks"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="inline-flex h-8 max-w-[240px] items-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-3 hover:bg-surface-3"
      >
        <span className="truncate text-[13px] font-medium">
          {project?.name ?? "Projects"}
          {selected ? ` / ${selected.name}` : ""}
        </span>
        <ChevronDown size={14} className="shrink-0 text-muted" />
      </button>
      {open ? (
        <div className="enter fixed left-3 top-14 z-30 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl sm:absolute sm:left-0 sm:top-11">
          <div className="border-b border-line px-4 py-2.5 text-[12px] font-medium text-muted">Projects and tasks</div>
          <div className="max-h-[65vh] space-y-2 overflow-auto p-2">
            {state.projects.map((project) => {
              const goals = state.goals.filter((goal) => goal.projectId === project.id);
              const closed = goals.filter((goal) => goal.status !== "open");
              return (
                <section key={project.id}>
                  <div className="flex items-center gap-2 px-2 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        setProject(project.id);
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-[12px] font-semibold text-muted hover:text-text"
                    >
                      <FolderGit2 size={14} className="shrink-0" />
                      <span className="truncate">{project.name}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`New task in ${project.name}`}
                      title="New task"
                      onClick={() => {
                        setNewTaskProject(project.id);
                        setOpen(false);
                      }}
                      className="rounded p-1 text-brass hover:bg-surface-3"
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                  <div className="ml-3 border-l border-line pl-2">
                    {goals.filter((goal) => goal.status === "open").map(row)}
                    {!goals.some((goal) => goal.status === "open") ? (
                      <p className="px-3 py-2 text-[12px] text-faint">No open tasks</p>
                    ) : null}
                    {closed.length ? (
                      <details open={closed.some((goal) => goal.id === ui.goalId) || undefined}>
                        <summary className="cursor-pointer px-3 py-2 text-[11px] text-faint hover:text-muted">
                          Done and archived · {closed.length}
                        </summary>
                        {closed.map(row)}
                      </details>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="flex gap-2 border-t border-line p-2">
            <button
              type="button"
              onClick={() => {
                setNewTaskProject(ui.projectId);
                setOpen(false);
              }}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-brass hover:bg-surface-3"
            >
              <Plus size={14} />
              New task
            </button>
            <button
              type="button"
              onClick={() => {
                setNewProjectOpen(true);
                setOpen(false);
              }}
              className="rounded-lg px-3 py-2 text-[12px] text-muted hover:bg-surface-2"
            >
              New project
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
