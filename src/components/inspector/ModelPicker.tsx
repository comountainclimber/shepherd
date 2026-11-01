import { CLAUDE_MODELS, EFFORT_LABEL, modelName, type ModelCatalog, type ModelChoice } from "../../model/models";
import { EFFORTS, type Effort } from "../../model/types";
import { Select } from "../ui";

const AGENT_NAME = { codex: "Codex", claude: "Claude Code" } as const;

/** The model and thinking for an agent's step. Empty means the agent's own default. */
export function ModelPicker({
  provider,
  catalog,
  model,
  effort,
  disabled = false,
  note,
  onChange,
}: {
  provider: "codex" | "claude";
  catalog: ModelCatalog | null;
  model?: string;
  effort?: Effort;
  disabled?: boolean;
  /** Said instead of the model's description, such as why it cannot change now. */
  note?: string;
  onChange: (model: string | null, effort: Effort | null) => void;
}) {
  const models = provider === "codex" ? (catalog?.codex.models ?? []) : CLAUDE_MODELS;
  const own = catalog?.[provider].default ?? { model: null, effort: null };
  const picked = model ? models.find((item) => item.id === model) : undefined;
  const effective = picked ?? models.find((item) => item.id === own.model);
  const efforts: Effort[] = effective?.efforts.length ? effective.efforts : EFFORTS.filter((level) => level !== "ultra");
  const defaultEffort = own.effort ?? effective?.defaultEffort;
  const current = models.filter((item) => !item.older);
  const older = models.filter((item) => item.older);
  const ownName = own.model ? ` (${modelName(own.model, catalog, provider)})` : "";

  const pickModel = (next: string) => {
    const choice = models.find((item) => item.id === next);
    const keeps = !effort || !choice?.efforts.length || choice.efforts.includes(effort);
    onChange(next || null, keeps ? (effort ?? null) : null);
  };

  const hint =
    note ??
    (picked
      ? picked.hint
      : model
        ? `${model} is not offered here, so ${AGENT_NAME[provider]} may refuse it.`
        : `From your ${AGENT_NAME[provider]} settings. It changes if you change them.`);

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1.5">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[11px] text-faint">Model</span>
          <Select aria-label="Model" className="w-full" value={model ?? ""} disabled={disabled} onChange={(event) => pickModel(event.target.value)}>
            <option value="">
              Your {AGENT_NAME[provider]} default{ownName}
            </option>
            {model && !picked ? <option value={model}>{model}</option> : null}
            <Options label={older.length ? "Current" : ""} models={current} />
            <Options label="Older models" models={older} />
          </Select>
        </label>
        <label className="w-[130px] shrink-0">
          <span className="mb-1 block text-[11px] text-faint">Thinking</span>
          <Select
            aria-label="Thinking"
            className="w-full"
            value={effort ?? ""}
            disabled={disabled}
            onChange={(event) => onChange(model ?? null, (event.target.value || null) as Effort | null)}
          >
            <option value="">Default{defaultEffort ? ` (${EFFORT_LABEL[defaultEffort]})` : ""}</option>
            {efforts.map((level) => (
              <option key={level} value={level}>
                {EFFORT_LABEL[level]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <p className="text-[11px] leading-4 text-faint">{hint}</p>
    </div>
  );
}

function Options({ label, models }: { label: string; models: ModelChoice[] }) {
  if (!models.length) return null;
  const options = models.map((item) => (
    <option key={item.id} value={item.id}>
      {item.name}
    </option>
  ));
  return label ? <optgroup label={label}>{options}</optgroup> : <>{options}</>;
}
