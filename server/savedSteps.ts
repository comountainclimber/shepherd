import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MAX_SAVED, STARTERS, readSavedSteps } from "../src/model/savedSteps";
import type { SavedStep } from "../src/model/types";

export interface SavedSteps {
  list(): SavedStep[];
  /** Replaces every saved step. Returns what was kept. */
  replace(raw: unknown): SavedStep[] | { error: string };
}

/**
 * Saved steps live in their own file beside the board, so clearing the board keeps them. A file
 * that does not exist yet means the starters; one that cannot be read is moved aside, not overwritten.
 */
export function createSavedSteps(file: string): SavedSteps {
  const read = (): SavedStep[] => {
    if (!existsSync(file)) return STARTERS;
    try {
      const body = JSON.parse(readFileSync(file, "utf8")) as { steps?: unknown } | null;
      if (!Array.isArray(body?.steps)) throw new Error("no steps list");
      return readSavedSteps(body.steps);
    } catch {
      const aside = `${file}.unreadable-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      renameSync(file, aside);
      console.warn(`[shepherd] Could not read ${file}; moved it to ${aside} and started from the starters.`);
      return STARTERS;
    }
  };

  return {
    list: read,
    replace(raw) {
      if (!Array.isArray(raw)) return { error: "Send the saved steps as a steps list." };
      if (raw.length > MAX_SAVED) return { error: `Keep at most ${MAX_SAVED} saved steps.` };
      const steps = readSavedSteps(raw);
      mkdirSync(path.dirname(file), { recursive: true });
      if (existsSync(file)) copyFileSync(file, `${file}.bak`);
      const temp = `${file}.tmp`;
      writeFileSync(temp, JSON.stringify({ schema: 1, steps }, null, 2));
      renameSync(temp, file);
      return steps;
    },
  };
}
