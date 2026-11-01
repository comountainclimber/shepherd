import { Check, FolderOpen, Undo2 } from "lucide-react";
import { useState } from "react";
import type { Dependency, Task } from "../../model/types";
import { markComplete, sendBack } from "../../runner/live";
import { useShepherd } from "../../store";
import { Button, Field, Select, TextArea } from "../ui";

/** A step you do: where to find the result so far, signing it off, and sending a problem back. */
export function YourStep({ task }: { task: Task }) {
  return (
    <div className="space-y-2.5">
      <Folder task={task} />
      {task.status === "failed" ? null : (
        <div className="flex items-center gap-3">
          <Button size="lg" variant="primary" onClick={() => void markComplete(task.id)}>
            <Check size={16} /> Mark done
          </Button>
          <p className="text-[12px] leading-5 text-muted">The steps after it start once you do.</p>
        </div>
      )}
      <SendBack task={task} />
    </div>
  );
}

function Folder({ task }: { task: Task }) {
  const [copied, setCopied] = useState(false);
  if (!task.git) return null;
  const folder = task.git.folder;
  return (
    <div className="rounded-lg border border-line bg-black/25 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <FolderOpen size={14} className="shrink-0 text-muted" />
        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-text" title={folder}>
          {folder}
        </code>
        <button
          type="button"
          className="shrink-0 text-[11px] font-medium text-muted hover:text-text"
          onClick={async () => {
            await navigator.clipboard.writeText(folder);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-faint">
        The earlier steps' work, merged together. Anything you change here becomes part of the result when you mark it done.
      </p>
    </div>
  );
}

function SendBack({ task }: { task: Task }) {
  const tasks = useShepherd((store) => store.state.tasks);
  const deps = useShepherd((store) => store.state.dependencies);
  const candidates = earlierAgentSteps(task.id, tasks, deps);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!candidates.length) return null;
  const target = candidates.some((item) => item.id === to) ? to : candidates[0]!.id;
  if (!open) {
    return (
      <button type="button" className="text-[12px] text-muted hover:text-text hover:underline" onClick={() => setOpen(true)}>
        Found a problem? Send it back
      </button>
    );
  }
  return (
    <form
      className="space-y-2 rounded-lg border border-line p-2.5"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const error = await sendBack(task.id, target, note);
        setBusy(false);
        if (error) return;
        setNote("");
        setOpen(false);
      }}
    >
      <Field label="Which step should fix it">
        <Select value={target} onChange={(event) => setTo(event.target.value)}>
          {candidates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name || "Untitled step"}
            </option>
          ))}
        </Select>
      </Field>
      <TextArea
        autoFocus
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What is wrong, and what you expected instead"
        aria-label="What is wrong"
      />
      <div className="flex items-center gap-2">
        <Button variant="danger" type="submit" disabled={!note.trim() || busy}>
          <Undo2 size={14} /> {busy ? "Sending…" : "Send back"}
        </Button>
        <Button variant="quiet" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="text-[11px] leading-4 text-faint">
        That step runs again with your note. The steps after it bring in the fix, and this step's folder updates.
      </p>
    </form>
  );
}

/** Agent steps this one builds on, directly or not, nearest first. */
function earlierAgentSteps(taskId: string, tasks: Task[], deps: Dependency[]): Task[] {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const seen = new Set<string>([taskId]);
  const found: Task[] = [];
  for (let queue = [taskId]; queue.length; ) {
    const next = queue.shift()!;
    for (const dep of deps) {
      if (dep.target !== next || seen.has(dep.source)) continue;
      seen.add(dep.source);
      queue.push(dep.source);
      const source = byId.get(dep.source);
      if (source?.runner === "agent") found.push(source);
    }
  }
  return found;
}
