import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acceptanceItems, markedCount } from "../src/model/acceptance";
import { blankTask } from "../src/model/factory";
import { isFullyVerified } from "../src/model/verify";
import { createEngine, tabAction } from "./engine";
import { markProgress } from "./progress";

function setup() {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "shepherd-progress-")), "state.json");
  const engine = createEngine(file, () => 1000);
  engine.dispatch({ type: "createTask", task: blankTask({ id: "step", projectId: "proj-local", name: "Build", objective: "Build", agentId: "agent-codex", position: { x: 0, y: 0 }, acceptance: ["Page loads", "Works on mobile", "Page loads"], checkCommand: "npm test" }) });
  engine.dispatch({ type: "setStatus", id: "step", status: "running" });
  const run = engine.timelines.append("step", { kind: "run_started", text: "Started" }).run;
  const task = () => engine.get().tasks[0];
  const items = acceptanceItems(task().acceptance);
  const request = { taskId: "step", run, item: 1, key: items[0].key, met: true, note: "Loaded the page with no console errors." };
  return { engine, file, task, items, request };
}

describe("Done when marks", () => {
  it("saves a bounded current mark on the step and records marks and withdrawals on the timeline", () => {
    const { engine, file, task, request } = setup();
    try {
      expect(markProgress(engine, request)).toEqual({ ok: true });
      expect(task().acceptanceMarks).toEqual({ [request.key]: { at: 1000, note: request.note } });
      expect(markedCount(task())).toBe(1);
      expect(task().verification[0].state).toBe("pending");
      engine.flush();
      const saved = JSON.parse(readFileSync(file, "utf8")).state.state.tasks[0];
      expect(saved.acceptanceMarks).toEqual(task().acceptanceMarks);
      expect(saved.timeline).toBeUndefined();
      const copy = path.join(mkdtempSync(path.join(tmpdir(), "shepherd-reloaded-progress-")), "state.json");
      copyFileSync(file, copy);
      const reloaded = createEngine(copy);
      expect(reloaded.get().tasks[0].acceptanceMarks).toEqual(task().acceptanceMarks);
      reloaded.close();
      expect(markProgress(engine, { ...request, met: false, note: undefined })).toEqual({ ok: true });
      expect(task().acceptanceMarks).toBeUndefined();
      expect(engine.timelines.read("step").entries.filter((entry) => entry.kind === "acceptance")).toEqual([
        expect.objectContaining({ kind: "acceptance", run: request.run, at: 1000, item: 1, text: "Page loads", met: true, note: request.note }),
        expect.objectContaining({ kind: "acceptance", run: request.run, item: 1, text: "Page loads", met: false }),
      ]);
    } finally { engine.close(); }
  });

  it("keeps marks with unchanged items when moved, separates duplicates, and drops edited or removed items", () => {
    const { engine, task, items, request } = setup();
    try {
      for (const item of items) expect(markProgress(engine, { ...request, key: item.key, item: item.number })).toEqual({ ok: true });
      expect(markedCount(task())).toBe(3);
      engine.dispatch({ type: "updateTask", id: "step", patch: { acceptance: ["Works on mobile", "Page loads", "Page loads"] } });
      expect(markedCount(task())).toBe(3);
      engine.dispatch({ type: "updateTask", id: "step", patch: { acceptance: ["Works on mobile", "Page loads without errors"] } });
      expect(markedCount(task())).toBe(1);
      expect(task().acceptanceMarks).toEqual({ [items[1].key]: expect.anything() });
      expect(markProgress(engine, request)).toEqual({ error: expect.stringContaining("changed or was removed") });
      engine.dispatch({ type: "updateTask", id: "step", patch: { acceptance: ["Page loads"] } });
      expect(task().acceptanceMarks).toBeUndefined();
      engine.dispatch({ type: "updateTask", id: "step", patch: { acceptance: [] } });
      expect(markedCount(task())).toBe(0);
    } finally { engine.close(); }
  });

  it("rejects missing items, bad notes, inactive runs and requests left over from an older run", () => {
    const { engine, task, request } = setup();
    try {
      for (const patch of [{ taskId: "missing" }, { run: 0 }, { item: 0 }, { key: "missing" }, { met: "yes" }, { note: " " }, { note: "x".repeat(501) }]) {
        expect(markProgress(engine, { ...request, ...patch })).toHaveProperty("error");
      }
      engine.timelines.append("step", { kind: "run_ended", text: "Stopped", outcome: "stopped" });
      expect(markProgress(engine, request)).toHaveProperty("error");
      const run = engine.timelines.append("step", { kind: "run_started", text: "Resumed" }).run;
      expect(markProgress(engine, request)).toHaveProperty("error");
      expect(markProgress(engine, { ...request, run })).toEqual({ ok: true });
      engine.dispatch({ type: "setStatus", id: "step", status: "completed" });
      expect(markProgress(engine, { ...request, run })).toHaveProperty("error");
      expect(isFullyVerified(task())).toBe(false);
      engine.dispatch({ type: "startCheck", taskId: "step" });
      engine.dispatch({ type: "recordCheck", taskId: "step", run: { command: "npm test", exitCode: 0, output: "ok", durationMs: 1 } });
      expect(isFullyVerified(task())).toBe(true);
      engine.dispatch({ type: "updateTask", id: "step", patch: { acceptanceMarks: undefined } });
      expect(isFullyVerified(task())).toBe(true);
    } finally { engine.close(); }
  });

  it("drops ambiguous marks when one of several identical items is edited or removed", () => {
    const { engine, task, items, request } = setup();
    try {
      expect(markProgress(engine, request)).toEqual({ ok: true });
      expect(markProgress(engine, { ...request, item: 3, key: items[2].key })).toEqual({ ok: true });
      engine.dispatch({ type: "updateTask", id: "step", patch: { acceptance: ["Page loads", "Works on mobile"] } });
      expect(task().acceptanceMarks).toBeUndefined();
    } finally { engine.close(); }
  });

  it("does not accept marks through tab actions", () => {
    const { engine, request } = setup();
    try {
      expect(tabAction(engine.get(), { type: "markAcceptance", id: "step", key: request.key, note: "Claim" })).toHaveProperty("error");
      expect(tabAction(engine.get(), { type: "updateTask", id: "step", patch: { acceptanceMarks: {} } })).toHaveProperty("error");
      expect(tabAction(engine.get(), { type: "createTask", task: { ...engine.get().tasks[0], status: "queued", acceptanceMarks: {} } })).toHaveProperty("error");
    } finally { engine.close(); }
  });
});
