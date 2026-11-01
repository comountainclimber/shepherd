import { Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cx } from "../../model/format";
import { runPlan, stopPlan } from "../../runner/live";
import { clearWorkspace, initialFilters, useShepherd } from "../../store";
import { appendStep } from "../outline/appendStep";
import { addSaved, placeFor } from "../saved/addSaved";
import { needsAbove } from "../saved/SavedPicker";
import { useSavedSteps } from "../saved/useSavedSteps";

export function CommandPalette() {
  const open = useShepherd((store) => store.ui.paletteOpen);
  const goalId = useShepherd((store) => store.ui.goalId);
  const running = useShepherd((store) => !!store.state.goals.find((project) => project.id === goalId)?.running);
  const setOpen = useShepherd((store) => store.setPaletteOpen);
  const setView = useShepherd((store) => store.setView);
  const setFilters = useShepherd((store) => store.setFilters);
  const setNewProjectOpen = useShepherd((store) => store.setNewProjectOpen);
  const requestDraft = useShepherd((store) => store.requestDraft);
  const requestFit = useShepherd((store) => store.requestFit);
  const selectedTaskId = useShepherd((store) => store.ui.selectedTaskId);
  const selectedName = useShepherd((store) => store.state.tasks.find((task) => task.id === selectedTaskId)?.name.trim());
  const setSaveFor = useShepherd((store) => store.setSaveFor);
  const setManageSaved = useShepherd((store) => store.setManageSaved);
  const hasSteps = useShepherd((store) => store.state.tasks.some((task) => task.goalId === goalId));
  const saved = useSavedSteps();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
  }, [open]);

  const commands = useMemo(() => {
    const show = (filters: Partial<typeof initialFilters>) => {
      setView("canvas");
      setFilters({ ...initialFilters, ...filters });
    };
    const target = selectedTaskId && selectedName !== undefined ? selectedTaskId : null;
    const place = placeFor(goalId, target);
    const addSavedCommands = (saved ?? [])
      .filter((entry) => !needsAbove(entry, place, !hasSteps))
      .map((entry) => ({ id: `saved-${entry.id}`, label: `Add saved step: ${entry.name}`, run: () => void addSaved(entry, placeFor(goalId, target)) }));
    return [
      { id: "add", label: "Add a step", hint: "N", run: () => appendStep(goalId) },
      { id: "draft", label: "Draft steps from a goal", run: () => requestDraft() },
      running
        ? { id: "stop", label: "Stop the plan", run: () => void stopPlan(goalId) }
        : { id: "run", label: "Run the plan", run: () => void runPlan(goalId) },
      { id: "new-project", label: "New project", run: () => setNewProjectOpen(true) },
      { id: "canvas", label: "Go to the map", hint: "1", run: () => setView("canvas") },
      { id: "agents", label: "Go to agents", hint: "2", run: () => setView("agents") },
      { id: "needs", label: "Show only what needs me", run: () => show({ savedView: "needs-me" }) },
      { id: "running", label: "Show only what is working", run: () => show({ savedView: "running" }) },
      { id: "failed", label: "Show only failures", run: () => show({ status: "failed" }) },
      { id: "all", label: "Show everything", run: () => show({}) },
      { id: "fit", label: "Fit the map to the screen", hint: "F", run: () => requestFit() },
      ...(selectedTaskId && selectedName ? [{ id: "save", label: "Save this step for reuse", run: () => setSaveFor(selectedTaskId) }] : []),
      { id: "manage", label: "Manage saved steps", run: () => setManageSaved(true) },
      ...addSavedCommands,
      { id: "reset", label: "Clear the whole board", run: clearWorkspace },
    ];
  }, [hasSteps, goalId, requestDraft, requestFit, running, saved, selectedName, selectedTaskId, setFilters, setManageSaved, setNewProjectOpen, setSaveFor, setView]);

  const filtered = commands.filter((command) => command.label.toLowerCase().includes(query.trim().toLowerCase()));
  const draftRow = query.trim() && filtered.length === 0;
  const count = draftRow ? 1 : filtered.length;
  const active = Math.min(index, Math.max(count - 1, 0));

  if (!open) return null;

  const runActive = () => {
    if (draftRow) {
      requestDraft(query.trim());
      return;
    }
    filtered[active]?.run();
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55" onMouseDown={() => setOpen(false)}>
      <div
        className="enter mx-auto mt-[14vh] w-[min(560px,calc(100%-32px))] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search size={17} className="text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((value) => Math.min(value + 1, count - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((value) => Math.max(value - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                runActive();
              }
            }}
            placeholder="A command, or a goal to break into steps"
            className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-faint"
          />
        </div>
        <ul className="max-h-80 overflow-auto p-1.5">
          {draftRow ? (
            <li>
              <button type="button" className="flex w-full items-center gap-2 rounded-lg bg-surface-3 px-3 py-2.5 text-left text-[14px] font-medium" onClick={runActive}>
                <Sparkles size={15} className="text-brass" /> Draft steps for “{query.trim()}”
              </button>
            </li>
          ) : (
            filtered.map((command, commandIndex) => (
              <li key={command.id}>
                <button
                  type="button"
                  className={cx(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[14px] font-medium",
                    commandIndex === active ? "bg-surface-3 text-text" : "text-muted",
                    command.id === "reset" && "text-failed",
                  )}
                  onMouseEnter={() => setIndex(commandIndex)}
                  onClick={() => {
                    command.run();
                    setOpen(false);
                  }}
                >
                  <span>{command.label}</span>
                  {command.hint ? <kbd className="rounded-md bg-black/30 px-1.5 font-mono text-[11px] text-faint">{command.hint}</kbd> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
