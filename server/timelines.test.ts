import { appendFileSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTimelines, TIMELINE_LIMIT } from "./timelines";
import { createTimelineParser } from "../src/runner/parse";

function store(limit = TIMELINE_LIMIT) {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-timeline-"));
  let time = 100;
  return { root, timeline: createTimelines(root, () => time++, limit) };
}

describe("timeline recording", () => {
  it("records Codex notes, bounded command lines, outcomes and changed files in arrival order", () => {
    const { timeline } = store();
    const parse = createTimelineParser();
    timeline.append("step", { kind: "run_started", text: "Started" });
    const record = (event: unknown) => parse(JSON.stringify(event)).forEach((entry) => timeline.append("step", entry));
    record({ type: "item.completed", item: { type: "agent_message", text: "Looking at the parser" } });
    record({ type: "item.started", item: { type: "command_execution", id: "cmd-1", command: `npm test ${"x".repeat(300)}\nSECRET SECOND LINE` } });
    record({ type: "item.completed", item: { type: "command_execution", id: "cmd-1", command: "npm test\nSECRET SECOND LINE", exit_code: 1, aggregated_output: "PRIVATE OUTPUT" } });
    record({ type: "item.completed", item: { type: "file_change", changes: [{ path: "src/parser.ts", kind: "update" }] } });
    const entries = timeline.read("step").entries;
    expect(entries.map((entry) => entry.kind)).toEqual(["run_started", "note", "command", "command_end", "files"]);
    expect(entries.map((entry) => entry.at)).toEqual([100, 101, 102, 103, 104]);
    expect(entries[2]).toMatchObject({ text: expect.any(String), commandId: "cmd-1" });
    expect("text" in entries[2] && entries[2].text.length).toBe(200);
    expect(entries[3]).toMatchObject({ text: "Exited 1" });
    expect(entries[4]).toMatchObject({ files: ["src/parser.ts"] });
    expect(JSON.stringify(entries)).not.toMatch(/SECRET|PRIVATE OUTPUT/);
  });

  it("records Claude Code text blocks and matches Bash and edit results without recording reasoning or tool output", () => {
    const { timeline } = store();
    const parse = createTimelineParser();
    const record = (event: unknown) => parse(JSON.stringify(event)).forEach((entry) => timeline.append("claude", entry));
    record({ type: "assistant", message: { content: [
      { type: "thinking", thinking: "private reasoning" },
      { type: "text", text: "I found the cause." },
      { type: "text", text: "Running the check." },
      { type: "tool_use", id: "b", name: "Bash", input: { command: "npm test\necho secret" } },
      { type: "tool_use", id: "e", name: "Edit", input: { file_path: "a.ts" } },
      { type: "tool_use", id: "f", name: "Write", input: { file_path: "failed.ts" } },
    ] } });
    record({ type: "user", message: { content: [
      { type: "tool_result", tool_use_id: "b", is_error: true, content: "private output" },
      { type: "tool_result", tool_use_id: "e", content: "edited" },
      { type: "tool_result", tool_use_id: "f", is_error: true },
    ] } });
    const entries = timeline.read("claude").entries;
    expect(entries.map((entry) => entry.kind)).toEqual(["note", "note", "command", "command_end", "files"]);
    expect(entries[2]).toMatchObject({ text: "npm test", commandId: "b" });
    expect(entries[3]).toMatchObject({ text: "Failed", commandId: "b" });
    expect(entries[4]).toMatchObject({ files: ["a.ts"] });
    expect(JSON.stringify(entries)).not.toMatch(/private|secret|failed.ts/);
  });

  it("appends without rewriting history and serves stable incremental cursors across restarts", () => {
    const { root, timeline } = store();
    timeline.append("one", { kind: "run_started", text: "Started" });
    const before = readFileSync(path.join(root, "one.jsonl"), "utf8");
    timeline.append("one", { kind: "note", text: "working" });
    expect(readFileSync(path.join(root, "one.jsonl"), "utf8").startsWith(before)).toBe(true);
    const fresh = createTimelines(root);
    expect(fresh.read("one", 1)).toMatchObject({ cursor: 2, first: 1, entries: [{ id: 2, run: 1, text: "working" }] });
    expect(fresh.read("one", 2).entries).toEqual([]);
    expect(fresh.read("two").entries).toEqual([]);
    appendFileSync(path.join(root, "one.jsonl"), '{"partial":');
    expect(fresh.append("one", { kind: "note", text: "after crash" }).id).toBe(3);
    expect(fresh.read("one").entries).toHaveLength(3);
    expect(() => fresh.read("../escape")).toThrow();
  });

  it("drops whole oldest runs first at the byte cap, keeping the latest run and sequence", () => {
    const { root, timeline } = store(1100);
    for (let run = 0; run < 3; run++) {
      timeline.append("step", { kind: "run_started", text: `Run ${run}` });
      timeline.append("step", { kind: "note", text: "é".repeat(140) });
      timeline.append("step", { kind: "run_ended", text: "Finished", outcome: "completed" });
    }
    const page = timeline.read("step");
    expect(statSync(path.join(root, "step.jsonl")).size).toBeLessThanOrEqual(1100);
    expect(page.entries[0]).toMatchObject({ kind: "run_started" });
    expect(page.first).toBeGreaterThan(1);
    expect(page.cursor).toBe(9);
    expect(page.entries.map((entry) => entry.run)).not.toContain(1);
    expect(timeline.append("step", { kind: "note", text: "next" }).id).toBe(10);
  });

  it("bounds one oversized run and an oversized entry even with multibyte text", () => {
    const { root, timeline } = store();
    timeline.append("step", { kind: "run_started", text: "Started" });
    for (let n = 0; n < 24; n++) timeline.append("step", { kind: "note", text: "😀".repeat(100_000) });
    expect(statSync(path.join(root, "step.jsonl")).size).toBeLessThanOrEqual(TIMELINE_LIMIT);
    expect(timeline.read("step").first).toBeGreaterThan(1);
    expect(timeline.read("step").cursor).toBe(25);
  });

  it("drops an old run's late check as a whole without reusing its cursor", () => {
    const { root, timeline } = store(600);
    const old = timeline.append("step", { kind: "run_started", text: "Started" }).run;
    timeline.append("step", { kind: "note", text: "a".repeat(150) });
    const latest = timeline.append("step", { kind: "run_started", text: "Resumed" }).run;
    timeline.append("step", { kind: "note", text: "b".repeat(150) });
    timeline.append("step", { kind: "check_ended", ok: true, text: "Late check" }, old);
    const page = timeline.read("step");
    expect(page.runs).toEqual([latest]);
    expect(page.cursor).toBe(5);
    expect(statSync(path.join(root, "step.jsonl")).size).toBeLessThanOrEqual(600);
    timeline.append("step", { kind: "check_ended", ok: true, text: "Another late check" }, old);
    expect(timeline.read("step").runs).toEqual([latest]);
    expect(createTimelines(root).append("step", { kind: "note", text: "next" })).toMatchObject({ id: 7, run: latest });
  });
});
