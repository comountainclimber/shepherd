import { useEffect, useState } from "react";
import { blockOf, relatives, savedId, upsertSaved } from "../../model/savedSteps";
import type { Task } from "../../model/types";
import { useShepherd } from "../../store";
import { notify } from "../shell/Toasts";
import { Button, Dialog, Field, TextInput } from "../ui";
import { putSavedSteps, useSavedSteps } from "./useSavedSteps";

/** Saves a step, and any steps beside or under it you pick, for adding to other projects. */
export function SaveDialog() {
  const taskId = useShepherd((store) => store.ui.saveFor);
  const task = useShepherd((store) => store.state.tasks.find((item) => item.id === taskId));
  const setSaveFor = useShepherd((store) => store.setSaveFor);
  if (!task) return null;
  return <SaveForm key={task.id} task={task} onClose={() => setSaveFor(null)} />;
}

function SaveForm({ task, onClose }: { task: Task; onClose: () => void }) {
  const state = useShepherd((store) => store.state);
  const saved = useSavedSteps();
  const [name, setName] = useState(task.name.trim() || "Untitled step");
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [keepChecklist, setKeepChecklist] = useState(false);
  const [clash, setClash] = useState(false);
  const { siblings, children } = relatives(state, task.id);
  useEffect(() => setClash(false), [name]);

  const ids = [task.id, ...siblings, ...children].filter((id) => id === task.id || included.has(id));
  const steps = ids.map((id) => state.tasks.find((item) => item.id === id)).filter((item): item is Task => !!item);
  const hasPerson = steps.some((item) => item.runner === "human");
  const trimmed = name.trim();
  const existing = (saved ?? []).find((entry) => entry.name.toLowerCase() === trimmed.toLowerCase());

  const save = async (replace: boolean) => {
    if (!saved || !trimmed) return;
    if (existing && !replace && !clash) {
      setClash(true);
      return;
    }
    const taken = new Set(saved.map((entry) => entry.name.toLowerCase()));
    let finalName = trimmed;
    for (let n = 2; !replace && taken.has(finalName.toLowerCase()); n += 1) finalName = `${trimmed} ${n}`;
    const items = blockOf(state, ids, () => keepChecklist);
    const id = replace && existing ? existing.id : savedId();
    if (await putSavedSteps(upsertSaved(saved, { id, name: finalName, steps: items }, Date.now()))) {
      notify(`Saved “${finalName}”.`, "Add it to any project with Add a saved step.");
      onClose();
    }
  };

  const toggle = (id: string) =>
    setIncluded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const named = (id: string) => state.tasks.find((item) => item.id === id)?.name || "Untitled step";

  return (
    <Dialog
      open
      title="Save for reuse"
      subtitle="Add it to any project later with Add a saved step."
      onClose={onClose}
      footer={
        clash ? (
          <>
            <span className="mr-auto text-[12px] text-approval">You already have a saved step called “{existing?.name}”.</span>
            <Button onClick={() => void save(false)}>Save as a new one</Button>
            <Button variant="primary" onClick={() => void save(true)}>
              Replace it
            </Button>
          </>
        ) : (
          <>
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!trimmed || !saved} onClick={() => void save(false)}>
              Save
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <TextInput
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void save(false)}
          />
        </Field>
        {siblings.length || children.length ? (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[12px] font-medium text-muted">Also include</legend>
            <Group title="Side by side with it" ids={siblings} included={included} toggle={toggle} named={named} />
            <Group title="Under it" ids={children} included={included} toggle={toggle} named={named} />
          </fieldset>
        ) : null}
        {hasPerson ? (
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-text">
            <input type="checkbox" className="mt-0.5 accent-brass" checked={keepChecklist} onChange={(event) => setKeepChecklist(event.target.checked)} />
            <span>
              Keep the checklist too
              <span className="block text-[11px] leading-4 text-faint">If you leave it out, Shepherd writes a fresh checklist from each project's earlier steps.</span>
            </span>
          </label>
        ) : null}
        <p className="text-[12px] leading-5 text-faint">
          Saves who does it, the model, what to tell the agent and More options. Leaves out its status, report, changes, screenshots and log.
        </p>
      </div>
    </Dialog>
  );
}

function Group({
  title,
  ids,
  included,
  toggle,
  named,
}: {
  title: string;
  ids: string[];
  included: Set<string>;
  toggle: (id: string) => void;
  named: (id: string) => string;
}) {
  if (!ids.length) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] text-faint">{title}</div>
      <ul className="space-y-1">
        {ids.map((id) => (
          <li key={id}>
            <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-text">
              <input type="checkbox" className="accent-brass" checked={included.has(id)} onChange={() => toggle(id)} />
              <span className="truncate">{named(id)}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
