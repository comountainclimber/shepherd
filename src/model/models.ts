import { EFFORTS, type Effort, type Task } from "./types";
import { agentById } from "./workspace";

/** A model a step's agent can use. */
export interface ModelChoice {
  id: string;
  name: string;
  hint: string;
  /** Thinking levels it offers. */
  efforts: Effort[];
  /** What it uses when the agent's settings do not say. */
  defaultEffort?: Effort;
  older?: boolean;
}

export interface AgentDefault {
  model: string | null;
  effort: Effort | null;
  /** The model the agent's settings name when the agent no longer offers it, so `model` stands in for it. */
  unavailable?: string;
}

/** What each agent can use here, and what it uses when a step does not say. */
export interface ModelCatalog {
  codex: { models: ModelChoice[]; default: AgentDefault };
  claude: { models: ModelChoice[]; default: AgentDefault };
}

export const EFFORT_LABEL: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
};

const CLAUDE_EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export const CLAUDE_MODELS: ModelChoice[] = [
  { id: "opus", name: "Opus", hint: "Very capable, for hard steps.", efforts: CLAUDE_EFFORTS },
  { id: "sonnet", name: "Sonnet", hint: "Fast and capable. Good for most steps.", efforts: CLAUDE_EFFORTS },
  { id: "haiku", name: "Haiku", hint: "The fastest and cheapest, for simple steps.", efforts: CLAUDE_EFFORTS },
];

/** A model name safe to hand to an agent's command line: it cannot pass for a flag. */
export function isModelId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][\w.:[\]-]{0,79}$/.test(value);
}

export function isEffort(value: unknown): value is Effort {
  return typeof value === "string" && (EFFORTS as readonly string[]).includes(value);
}

export function providerOf(task: Pick<Task, "runner" | "agentId">): "codex" | "claude" | null {
  if (task.runner !== "agent") return null;
  const provider = agentById(task.agentId)?.provider;
  return provider === "codex" ? "codex" : provider === "claude-code" ? "claude" : null;
}

/** The model and thinking to name to an agent: the step's own, or the stand-in for a default the agent no longer offers. */
export function agentChoice(choice: Pick<Task, "model" | "effort">, own: AgentDefault): Pick<Task, "model" | "effort"> {
  if (choice.model || !own.unavailable || !own.model) return choice;
  return { model: own.model, ...(choice.effort || own.effort ? { effort: choice.effort ?? own.effort! } : {}) };
}

export function modelName(id: string, catalog: ModelCatalog | null, provider: "codex" | "claude"): string {
  const models = provider === "codex" ? catalog?.codex.models : CLAUDE_MODELS;
  return models?.find((model) => model.id === id)?.name ?? id;
}

/** The model and thinking a step picked, such as "Example Codex Current · Max", or "" when it uses the defaults. */
export function choiceLabel(task: Pick<Task, "runner" | "agentId" | "model" | "effort">, catalog: ModelCatalog | null): string {
  const provider = providerOf(task);
  if (!provider || (!task.model && !task.effort)) return "";
  if (!task.model) return `${EFFORT_LABEL[task.effort!]} thinking`;
  return [modelName(task.model, catalog, provider), task.effort ? EFFORT_LABEL[task.effort] : ""].filter(Boolean).join(" · ");
}
