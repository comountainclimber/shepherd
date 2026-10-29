import { useEffect, useMemo, useState } from "react";
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

  const commands = useMemo(
    () => [
      { id: "new-project", label: "New project", run: () => setNewProjectOpen(true) },
      { id: "new", label: "New task", hint: "N", run: () => setNewTaskOpen(true) },
      { id: "decompose", label: "Decompose task", run: () => setDecomposeOpen(true) },
      { id: "canvas", label: "Go to canvas", hint: "1", run: () => setView("canvas") },
      { id: "agents", label: "Go to agents", hint: "2", run: () => setView("agents") },
      { id: "project", label: "Go to project", hint: "3", run: () => setView("project") },
      { id: "needs", label: "Show tasks that need me", run: () => { setView("canvas"); setFilters({ ...initialFilters, savedView: "needs-me" }); } },
      { id: "running", label: "Show running tasks", run: () => { setView("canvas"); setFilters({ ...initialFilters, savedView: "running" }); } },
      { id: "unverified", label: "Show unverified completions", run: () => { setView("canvas"); setFilters({ ...initialFilters, savedView: "unverified" }); } },
      { id: "fit", label: "Fit canvas", hint: "F", run: () => requestFit() },
      { id: "reset", label: "Clear workspace", run: clearWorkspace },
    ],
    [requestFit, setDecomposeOpen, setFilters, setNewProjectOpen, setNewTaskOpen, setView],
  );

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
    <div className="fixed inset-0 z-50 bg-black/50" onMouseDown={() => setOpen(false)}>
      <div
        className="mx-auto mt-[14vh] w-[min(560px,calc(100%-32px))] border border-line bg-surface"
        onMouseDown={(event) => event.stopPropagation()}
      >
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
          placeholder="Command, or an objective to decompose"
          className="h-10 w-full border-b border-line bg-transparent px-3 text-[13px] outline-none placeholder:text-faint"
        />
        <ul className="max-h-80 overflow-auto py-1">
          {decomposeRow ? (
            <li>
              <button type="button" className="block w-full bg-surface-2 px-3 py-2 text-left text-[12px]" onClick={runActive}>
                Decompose “{query.trim()}”
              </button>
            </li>
          ) : (
            filtered.map((command, commandIndex) => (
              <li key={command.id}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] ${commandIndex === active ? "bg-surface-2 text-text" : "text-muted"}`}
                  onMouseEnter={() => setIndex(commandIndex)}
                  onClick={() => {
                    command.run();
                    setOpen(false);
                  }}
                >
                  <span>{command.label}</span>
                  {command.hint ? <span className="font-mono text-[10px] text-faint">{command.hint}</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
