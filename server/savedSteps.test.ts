import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STARTERS } from "../src/model/savedSteps";
import { createSavedSteps } from "./savedSteps";

let dir = "";
let file = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "shepherd-saved-"));
  file = path.join(dir, ".shepherd", "saved-steps.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const mine = { id: "saved-mine", name: "Mine", version: 1, updatedAt: 1, steps: [{ name: "Do it", runner: "agent", agentId: "agent-codex", objective: "", description: "", acceptance: [], depth: 0 }] };

describe("saved steps store", () => {
  it("starts with the starters and writes nothing until you save", () => {
    expect(createSavedSteps(file).list()).toEqual(STARTERS);
    expect(existsSync(file)).toBe(false);
  });

  it("saves the list and keeps the one before as a backup", () => {
    const store = createSavedSteps(file);
    store.replace(STARTERS);
    expect(store.replace([mine])).toEqual([mine]);
    expect(store.list()).toEqual([mine]);
    expect(JSON.parse(readFileSync(`${file}.bak`, "utf8")).steps).toEqual(STARTERS);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it("keeps an empty list empty, rather than bringing the starters back", () => {
    const store = createSavedSteps(file);
    store.replace([]);
    expect(store.list()).toEqual([]);
  });

  it("refuses something that is not a list, and changes nothing", () => {
    const store = createSavedSteps(file);
    store.replace([mine]);
    expect(store.replace({ steps: [] })).toEqual({ error: "Send the saved steps as a steps list." });
    expect(store.list()).toEqual([mine]);
  });

  it("moves a file it cannot read aside instead of overwriting it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createSavedSteps(file);
    store.replace([mine]);
    writeFileSync(file, "{ not json");
    expect(store.list()).toEqual(STARTERS);
    const aside = readdirSync(path.dirname(file)).find((name) => name.startsWith("saved-steps.json.unreadable-"));
    expect(aside && readFileSync(path.join(path.dirname(file), aside), "utf8")).toBe("{ not json");
  });
});
