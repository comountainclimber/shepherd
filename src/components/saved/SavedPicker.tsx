import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "../../model/format";
import { withStarters } from "../../model/savedSteps";
import type { AssigneeKind } from "../../model/stage";
import type { SavedPlace, SavedStep, SavedStepItem } from "../../model/types";
import { useShepherd } from "../../store";
import { Avatar } from "../ui";
import { addSaved } from "./addSaved";
import { putSavedSteps, useSavedSteps } from "./useSavedSteps";

export function kindOf(step: SavedStepItem): AssigneeKind {
  return step.runner === "human" ? "person" : step.agentId === "agent-claude" ? "claude" : "codex";
}

/** The first line of what a saved step tells its agent, or what happens when it says nothing. */
export function promptLine(step: SavedStepItem): string {
  const line = step.objective.split("\n").find((text) => text.trim())?.trim();
  if (line) return line;
  return step.runner === "human" ? "Shepherd writes a checklist from the earlier steps' work." : "Its name is its prompt.";
}

/** Steps saved to run side by side need a step above them to run under. */
export function needsAbove(saved: SavedStep, place: SavedPlace, empty: boolean): boolean {
  return (empty || (place.after === null && place.depth === 0)) && saved.steps[0]!.depth > 0;
}

/** Your saved steps, to search and pick one to add where the outline says. */
export function SavedPicker({ place }: { place: SavedPlace }) {
  const saved = useSavedSteps();
  const projectId = useShepherd((store) => store.ui.projectId);
  const empty = useShepherd((store) => !store.state.tasks.some((task) => task.projectId === projectId && task.id !== place.replace));
  const setAddSaved = useShepherd((store) => store.setAddSaved);
  const setManageSaved = useShepherd((store) => store.setManageSaved);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setAddSaved(null);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [setAddSaved]);

  const needle = query.trim().toLowerCase();
  const matches = (saved ?? []).filter(
    (entry) => !needle || entry.name.toLowerCase().includes(needle) || entry.steps.some((step) => step.objective.toLowerCase().includes(needle)),
  );
  const active = Math.min(index, Math.max(matches.length - 1, 0));
  const pick = (entry: SavedStep | undefined) => {
    if (entry && !needsAbove(entry, place, empty)) void addSaved(entry, place);
  };

  return (
    <div ref={box} className="enter my-1 overflow-hidden rounded-lg border border-line-strong bg-surface-2 shadow-xl">
      <div className="flex items-center gap-2 border-b border-line px-2.5">
        <Search size={14} className="shrink-0 text-faint" />
        <input
          autoFocus
          value={query}
          placeholder="Find a saved step"
          aria-label="Find a saved step"
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setIndex(Math.max(0, Math.min(active + (event.key === "ArrowDown" ? 1 : -1), matches.length - 1)));
            } else if (event.key === "Enter") {
              event.preventDefault();
              pick(matches[active]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setAddSaved(null);
            }
          }}
          className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
        />
      </div>
      <div className="px-3 pb-1 pt-2 text-[11px] text-faint">{place.label}</div>
      {saved === null ? (
        <p className="px-3 pb-3 text-[12px] text-muted">Loading…</p>
      ) : saved.length === 0 ? (
        <div className="space-y-2 px-3 pb-3 text-[12px] leading-5 text-muted">
          <p>No saved steps yet. Open a step and choose Save for reuse to use it in other projects.</p>
          <button type="button" className="text-brass hover:underline" onClick={() => void putSavedSteps(withStarters(saved))}>
            Bring back the starters
          </button>
        </div>
      ) : matches.length === 0 ? (
        <p className="px-3 pb-3 text-[12px] text-muted">Nothing called “{query.trim()}”.</p>
      ) : (
        <ul className="max-h-72 overflow-auto px-1 pb-1" role="listbox" aria-label="Saved steps">
          {matches.map((entry, entryIndex) => {
            const blocked = needsAbove(entry, place, empty);
            const first = entry.steps[0]!;
            return (
              <li key={entry.id} role="option" aria-selected={entryIndex === active}>
                <button
                  type="button"
                  disabled={blocked}
                  onMouseEnter={() => setIndex(entryIndex)}
                  onClick={() => pick(entry)}
                  className={cx(
                    "flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left disabled:cursor-not-allowed",
                    entryIndex === active ? "bg-surface-3" : "",
                  )}
                >
                  <Avatar kind={kindOf(first)} size={22} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={cx("truncate text-[13px] font-medium", blocked ? "text-muted" : "text-text")}>{entry.name}</span>
                      {entry.steps.length > 1 ? (
                        <span className="shrink-0 rounded bg-white/5 px-1.5 text-[10px] text-muted">{entry.steps.length} steps</span>
                      ) : null}
                    </span>
                    <span className="block truncate text-[11px] text-faint">
                      {blocked ? "These run side by side, so add them below another step." : promptLine(first)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="border-t border-line px-3 py-1.5">
        <button type="button" className="text-[12px] text-muted hover:text-text" onClick={() => setManageSaved(true)}>
          Manage saved steps
        </button>
      </div>
    </div>
  );
}
