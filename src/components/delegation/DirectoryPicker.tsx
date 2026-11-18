import { useEffect, useState } from "react";
import { Button } from "../ui";

interface Choices {
  directory: string;
  parent: string;
  directories: string[];
}

export function DirectoryPicker({ initial, onSelect, onCancel }: { initial: string; onSelect: (directory: string) => void; onCancel: () => void }) {
  const [path, setPath] = useState(initial || "~");
  const [choices, setChoices] = useState<Choices | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setChoices(null);
    setProblem("");
    void fetch(`/api/directories?path=${encodeURIComponent(path)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as Choices & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not read this directory.");
        if (!controller.signal.aborted) setChoices(result);
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setProblem(error instanceof Error ? error.message : "Could not read this directory."); });
    return () => controller.abort();
  }, [path]);

  return (
    <div className="space-y-2 rounded-lg border border-line p-3" aria-label="Choose a workspace directory">
      <p className="break-all font-mono text-[11px] text-muted">{choices?.directory ?? path}</p>
      {choices ? (
        <>
          <div className="max-h-44 overflow-y-auto">
            {choices.parent !== choices.directory ? <button type="button" className="block w-full rounded px-2 py-1 text-left text-[12px] hover:bg-surface-2" onClick={() => setPath(choices.parent)}>.. (Parent directory)</button> : null}
            {choices.directories.map((name) => <button key={name} type="button" className="block w-full truncate rounded px-2 py-1 text-left text-[12px] hover:bg-surface-2" onClick={() => setPath(`${choices.directory}/${name}`)}>{name}/</button>)}
          </div>
          <Button onClick={() => onSelect(choices.directory)}>Use this directory</Button>
        </>
      ) : <p role="status" className="text-[12px] text-muted">{problem || "Reading directory…"}</p>}
      {problem ? <Button onClick={() => setPath("~")}>Home directory</Button> : null}
      <Button variant="quiet" onClick={onCancel}>Cancel browsing</Button>
    </div>
  );
}
