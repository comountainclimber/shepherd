import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { CLAUDE_MODELS, isEffort, isModelId, type ModelCatalog, type ModelChoice } from "../src/model/models";
import type { Effort } from "../src/model/types";

/** What Codex and Claude Code can use on this machine, read from their own files each time. */
export function modelCatalog(env: NodeJS.ProcessEnv = process.env): ModelCatalog {
  const codexHome = env.CODEX_HOME || path.join(homedir(), ".codex");
  const claudeHome = env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude");
  return {
    codex: { models: codexModels(read(path.join(codexHome, "models_cache.json"))), default: codexDefault(read(path.join(codexHome, "config.toml"))) },
    claude: { models: CLAUDE_MODELS, default: claudeDefault(read(path.join(claudeHome, "settings.json"))) },
  };
}

function read(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function codexModels(json: string): ModelChoice[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  const models = raw && typeof raw === "object" ? (raw as { models?: unknown }).models : null;
  if (!Array.isArray(models)) return [];
  return models
    .filter((model) => model && typeof model === "object" && model.visibility === "list" && isModelId(model.slug))
    .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))
    .map((model) => {
      const hint = typeof model.description === "string" ? model.description.trim() : "";
      const efforts = (Array.isArray(model.supported_reasoning_levels) ? model.supported_reasoning_levels : [])
        .map((level: unknown) => (level && typeof level === "object" ? (level as { effort?: unknown }).effort : level))
        .filter(isEffort);
      return {
        id: model.slug,
        name: typeof model.display_name === "string" && model.display_name.trim() ? model.display_name.trim() : model.slug,
        hint,
        efforts,
        ...(isEffort(model.default_reasoning_level) ? { defaultEffort: model.default_reasoning_level } : {}),
        ...(/\b(older|previous)\b/i.test(hint) ? { older: true } : {}),
      };
    });
}

/** The model and thinking Codex uses when it is not told, from the top of its config.toml. */
export function codexDefault(toml: string): { model: string | null; effort: Effort | null } {
  const top = toml.split(/^\s*\[/m)[0] ?? "";
  const value = (key: string) => new RegExp(`^\\s*${key}\\s*=\\s*["']([^"'\\n]+)["']`, "m").exec(top)?.[1] ?? null;
  const model = value("model");
  const effort = value("model_reasoning_effort");
  return { model: isModelId(model) ? model : null, effort: isEffort(effort) ? effort : null };
}

function claudeDefault(json: string): { model: string | null; effort: Effort | null } {
  try {
    const settings = JSON.parse(json) as { model?: unknown; effortLevel?: unknown };
    return { model: isModelId(settings.model) ? settings.model : null, effort: isEffort(settings.effortLevel) ? settings.effortLevel : null };
  } catch {
    return { model: null, effort: null };
  }
}
