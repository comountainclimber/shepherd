import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "./timeline";
import { mergeTimeline, quietTime, timelineRows } from "./timelineView";

const base = { run: 1, at: 0 };
describe("timeline presentation", () => {
  it("folds adjacent commands once, matches outcomes, and keeps notes and long silences in order", () => {
    const entries: TimelineEntry[] = [
      { ...base, id: 1, kind: "note", text: "Starting" },
      { ...base, id: 2, kind: "command", commandId: "a", text: "ls" },
      { ...base, id: 3, kind: "command_end", commandId: "a", text: "Exited 0" },
      { ...base, id: 4, kind: "command", commandId: "b", text: "npm test" },
      { ...base, id: 5, kind: "command", commandId: "b", text: "npm test" },
      { ...base, id: 6, kind: "command_end", commandId: "b", text: "Exited 1" },
      { ...base, id: 7, at: 600_001, kind: "note", text: "Fixing it" },
    ];
    const rows = timelineRows(entries);
    expect(rows.map((row) => row.kind)).toEqual(["entry", "commands", "gap", "entry"]);
    expect(rows[1]).toMatchObject({ entries: [{ commandId: "a" }, { commandId: "b" }] });
    expect(timelineRows(entries, 1_300_000).at(-1)?.kind).toBe("gap");
    expect(timelineRows(entries.slice(0, 1), 600_000)).toHaveLength(1);
    expect(quietTime(0, 8 * 3600_000)).toMatch(/^Nothing for 8 hours, .+ to .+$/);
  });

  it("deduplicates incremental entries and drops history removed by the server cap", () => {
    const entry: TimelineEntry = { ...base, id: 2, kind: "note", text: "new" };
    expect(mergeTimeline([{ ...entry, id: 1 }, entry], { entries: [entry], first: 2, cursor: 2 })).toEqual([entry]);
    expect(mergeTimeline([entry, { ...entry, id: 3, run: 3 }], { entries: [], first: 2, cursor: 3, runs: [3] })).toEqual([{ ...entry, id: 3, run: 3 }]);
  });
});
