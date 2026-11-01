import { Trash2 } from "lucide-react";
import { useState } from "react";
import { cx } from "../../model/format";
import { providerOf } from "../../model/models";
import { STARTERS, upsertSaved, withStarters } from "../../model/savedSteps";
import type { SavedStep, SavedStepItem } from "../../model/types";
import { useShepherd } from "../../store";
import { ModelPicker } from "../inspector/ModelPicker";
import { Avatar, Button, Dialog, Field, Select, TextArea, TextInput } from "../ui";
import { useModels } from "../useModels";
import { kindOf, promptLine } from "./SavedPicker";
import { putSavedSteps, useSavedSteps } from "./useSavedSteps";

/** Every saved step, to edit, rename or delete. Steps already added to projects keep their copy. */
export function ManageDialog() {
  const open = useShepherd((store) => store.ui.manageSaved);
  const setManageSaved = useShepherd((store) => store.setManageSaved);
  if (!open) return null;
  return <Manage onClose={() => setManageSaved(false)} />;
}

function Manage({ onClose }: { onClose: () => void }) {
  const saved = useSavedSteps();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SavedStep | null>(null);
  const list = saved ?? [];
  const selected = list.find((entry) => entry.id === selectedId) ?? list[0] ?? null;
  const editing = draft && draft.id === selected?.id ? draft : selected;
  const dirty = !!draft && !!selected && draft.id === selected.id && JSON.stringify(draft) !== JSON.stringify(selected);
  const missingStarters = STARTERS.some((starter) => !list.some((entry) => entry.id === starter.id));

  const choose = (id: string) => {
    if (dirty && !window.confirm(`Discard your changes to “${selected!.name}”?`)) return;
    setDraft(null);
    setSelectedId(id);
  };
  const close = () => {
    if (dirty && !window.confirm(`Discard your changes to “${selected!.name}”?`)) return;
    onClose();
  };
  const saveDraft = async () => {
    if (!draft || !saved) return;
    const steps = draft.steps.map((step) => ({ ...step, name: step.name.trim() || "Untitled step" }));
    if (await putSavedSteps(upsertSaved(saved, { ...draft, name: draft.name.trim() || steps[0]!.name, steps }, Date.now()))) setDraft(null);
  };
  const remove = async (entry: SavedStep) => {
    if (!saved || !window.confirm(`Delete “${entry.name}”? Steps already added to projects keep their copy.`)) return;
    if (await putSavedSteps(saved.filter((item) => item.id !== entry.id))) {
      setDraft(null);
      setSelectedId(null);
    }
  };

  return (
    <Dialog
      open
      wide
      title="Saved steps"
      subtitle="Steps you can add to any project. Changing one here leaves the copies already in projects as they are."
      onClose={close}
      footer={
        <>
          {missingStarters && list.length ? (
            <button type="button" className="mr-auto text-[12px] text-brass hover:underline" onClick={() => void putSavedSteps(withStarters(list))}>
              Bring back the starters
            </button>
          ) : null}
          <Button variant="quiet" onClick={close}>
            Close
          </Button>
          {editing ? (
            <Button variant="primary" disabled={!dirty} onClick={() => void saveDraft()}>
              Save changes
            </Button>
          ) : null}
        </>
      }
    >
      {saved === null ? (
        <p className="text-[13px] text-muted">Loading…</p>
      ) : !list.length ? (
        <div className="space-y-3 py-6 text-center text-[13px] text-muted">
          <p>No saved steps yet. Open a step and choose Save for reuse to use it in other projects.</p>
          <Button onClick={() => void putSavedSteps(withStarters(list))}>Bring back the starters</Button>
        </div>
      ) : (
        <div className="flex min-h-[22rem] gap-4">
          <ul className="w-52 shrink-0 space-y-0.5 border-r border-line pr-3">
            {list.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => choose(entry.id)}
                  className={cx(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left",
                    entry.id === editing?.id ? "bg-surface-3" : "hover:bg-surface-2",
                  )}
                >
                  <Avatar kind={kindOf(entry.steps[0]!)} size={20} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-text">{entry.name}</span>
                    <span className="block truncate text-[11px] text-faint">
                      {entry.steps.length > 1 ? `${entry.steps.length} steps` : promptLine(entry.steps[0]!)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {editing ? <Editor key={editing.id} value={editing} onChange={setDraft} onDelete={() => void remove(editing)} /> : null}
        </div>
      )}
    </Dialog>
  );
}

function Editor({ value, onChange, onDelete }: { value: SavedStep; onChange: (next: SavedStep) => void; onDelete: () => void }) {
  const update = (index: number, step: SavedStepItem) => onChange({ ...value, steps: value.steps.map((item, at) => (at === index ? step : item)) });
  return (
    <div className="min-w-0 flex-1 space-y-4">
      <Field label="Name">
        <TextInput value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} />
      </Field>
      {value.steps.map((step, index) => (
        <ItemFields key={index} step={step} titled={value.steps.length > 1} onChange={(next) => update(index, next)} />
      ))}
      <div className="border-t border-line pt-3">
        <Button variant="quiet" className="text-failed hover:bg-failed/10" onClick={onDelete}>
          <Trash2 size={14} /> Delete this saved step
        </Button>
      </div>
    </div>
  );
}

/** One step of a saved step, edited the way the Step tab edits a step on the board. */
function ItemFields({ step, titled, onChange }: { step: SavedStepItem; titled: boolean; onChange: (next: SavedStepItem) => void }) {
  const catalog = useModels();
  const agent = step.runner === "agent";
  const provider = providerOf({ runner: step.runner, agentId: step.agentId });
  const who = step.runner === "human" ? "human" : (step.agentId ?? "agent-codex");
  const setWho = (next: string) => {
    const { model: _model, effort: _effort, review: _review, independent: _independent, ...rest } = step;
    if (next === "human") onChange({ ...rest, runner: "human", agentId: null });
    else onChange({ ...(next === step.agentId ? step : rest), runner: "agent", agentId: next });
  };
  return (
    <section className={cx("space-y-3", titled && "rounded-lg border border-line p-3")} style={titled ? { marginLeft: step.depth * 16 } : undefined}>
      {titled ? (
        <Field label="Step name">
          <TextInput value={step.name} onChange={(event) => onChange({ ...step, name: event.target.value })} />
        </Field>
      ) : null}
      <Field label="Who does it">
        <Select value={who} onChange={(event) => setWho(event.target.value)}>
          <option value="agent-codex">Codex</option>
          <option value="agent-claude">Claude Code</option>
          <option value="human">You</option>
        </Select>
      </Field>
      {provider ? (
        <ModelPicker
          provider={provider}
          catalog={catalog}
          model={step.model}
          effort={step.effort}
          onChange={(model, effort) => {
            const { model: _model, effort: _effort, ...rest } = step;
            onChange({ ...rest, ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
          }}
        />
      ) : null}
      <Field label={agent ? "What to tell the agent" : "What you do"}>
        <TextArea
          className="min-h-28"
          value={step.objective}
          placeholder={agent ? "Its name is its prompt." : "Leave it empty and Shepherd writes a checklist from each project's earlier steps."}
          onChange={(event) => onChange({ ...step, objective: event.target.value })}
        />
      </Field>
      <Field label="Background">
        <TextArea
          value={step.description}
          placeholder="Anything this project needs, like how to start it and its address."
          onChange={(event) => onChange({ ...step, description: event.target.value })}
        />
      </Field>
      <Field label="Done when (one per line)">
        <TextArea
          value={step.acceptance.join("\n")}
          placeholder="The page loads without errors"
          onChange={(event) => onChange({ ...step, acceptance: event.target.value.split("\n") })}
        />
      </Field>
      <Field label="Check command">
        <TextInput
          className="font-mono"
          value={step.checkCommand ?? ""}
          placeholder="npm test"
          onChange={(event) => {
            const { checkCommand: _checkCommand, ...rest } = step;
            onChange(event.target.value ? { ...rest, checkCommand: event.target.value } : rest);
          }}
        />
      </Field>
      {agent ? (
        <div className="space-y-1.5">
          <Check label="Ask me to review it" checked={!!step.review} onChange={(review) => onChange(flag(step, "review", review))} />
          <Check label="Judge independently" checked={!!step.independent} onChange={(independent) => onChange(flag(step, "independent", independent))} />
        </div>
      ) : null}
    </section>
  );
}

function flag(step: SavedStepItem, key: "review" | "independent", on: boolean): SavedStepItem {
  const { [key]: _was, ...rest } = step;
  return on ? { ...rest, [key]: true } : rest;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-text">
      <input type="checkbox" className="accent-brass" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
