import { Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cx } from "../../model/format";
import { clearWorkspace, initialFilters, useShepherd } from "../../store";

export function CommandPalette() {
  const open = useShepherd((store) => store.ui.paletteOpen);
  const setOpen = useShepherd((store) => store.setPaletteOpen);
  const setView = useShepherd((store) => store.setView);
  const setFilters = useShepherd((store) => store.setFilters);
  const setNewTaskOpen = useShepherd((store) => store.setNewTaskOpen);
  const setNewProjectOpen = useShepherd((store) => store.setNewProjectOpen);
  const setDecomposeOpen = useShepherd((store) => store.setDecomposeOpen);
  const setDecomposeSeed = useShepherd((store) => store.setDecomposeSeed);
  const requestFit = useShepherd((store) => store.requestFit);
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
    return [
      { id: "new", label: "New task", hint: "N", run: () => setNewTaskOpen(true) },
      { id: "decompose", label: "Plan tasks from a goal", run: () => setDecomposeOpen(true) },
      { id: "new-project", label: "New project", run: () => setNewProjectOpen(true) },
      { id: "canvas", label: "Go to the board", hint: "1", run: () => setView("canvas") },
      { id: "agents", label: "Go to agents", hint: "2", run: () => setView("agents") },
      { id: "needs", label: "Show only what needs me", run: () => show({ savedView: "needs-me" }) },
      { id: "running", label: "Show only what is working", run: () => show({ savedView: "running" }) },
      { id: "failed", label: "Show only failures", run: () => show({ status: "failed" }) },
      { id: "unverified", label: "Show done but not yet proven", run: () => show({ savedView: "unverified" }) },
      { id: "all", label: "Show everything", run: () => show({}) },
      { id: "fit", label: "Fit the map to the screen", hint: "F", run: () => requestFit() },
      { id: "reset", label: "Clear the whole board", run: clearWorkspace },
    ];
  }, [requestFit, setDecomposeOpen, setFilters, setNewProjectOpen, setNewTaskOpen, setView]);

  const filtered = commands.filter((command) => command.label.toLowerCase().includes(query.trim().toLowerCase()));
  const decomposeRow = query.trim() && filtered.length === 0;
  const count = decomposeRow ? 1 : filtered.length;
  const active = Math.min(index, Math.max(count - 1, 0));

  if (!open) return null;

  const runActive = () => {
    if (decomposeRow) {
      setDecomposeSeed(query.trim());
      setDecomposeOpen(true);
      setOpen(false);
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
            placeholder="A command, or a goal to plan"
            className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-faint"
          />
        </div>
        <ul className="max-h-80 overflow-auto p-1.5">
          {decomposeRow ? (
            <li>
              <button type="button" className="flex w-full items-center gap-2 rounded-lg bg-surface-3 px-3 py-2.5 text-left text-[14px] font-medium" onClick={runActive}>
                <Sparkles size={15} className="text-brass" /> Plan tasks for “{query.trim()}”
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
