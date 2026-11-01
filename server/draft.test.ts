import { describe, expect, it } from "vitest";
import { blankTask } from "../src/model/factory";
import { reducer } from "../src/model/reducer";
import type { Action, OrchestrationState } from "../src/model/types";
import { workspace } from "../src/model/workspace";
import { MAX_DRAFT_STEPS, checklistInput, checklistPrompt, parseChecklist, parseDraft } from "./draft";

describe("parseDraft", () => {
  it("reads the steps out of a reply with prose and a code fence around them", () => {
    const reply = 'Here is the plan:\n```json\n{"steps":[{"name":" Build it ","prompt":"Make it.","depth":1},{"name":"Test it","prompt":"","depth":1}]}\n```';
    expect(parseDraft(reply)).toEqual([
      { name: "Build it", prompt: "Make it.", depth: 0 },
      { name: "Test it", prompt: "", depth: 1 },
    ]);
  });

  it("drops steps with no name and treats an odd depth as the top level", () => {
    const reply = JSON.stringify({ steps: [{ name: "A", depth: 0 }, { prompt: "nameless" }, { name: "B", depth: 7 }] });
    expect(parseDraft(reply)).toEqual([
      { name: "A", prompt: "", depth: 0 },
      { name: "B", prompt: "", depth: 0 },
    ]);
  });

  it("keeps at most a dozen steps", () => {
    const steps = Array.from({ length: 20 }, (_, index) => ({ name: `Step ${index}`, prompt: "", depth: 0 }));
    expect(parseDraft(JSON.stringify({ steps }))).toHaveLength(MAX_DRAFT_STEPS);
  });

  it("explains a reply it cannot use", () => {
    expect(parseDraft("I could not do that.")).toEqual({ error: "The agent did not reply with a plan." });
    expect(parseDraft("{nope}")).toEqual({ error: "The agent's plan was not valid JSON." });
    expect(parseDraft('{"steps":[]}')).toEqual({ error: "The agent's plan had no usable steps." });
  });
});

describe("checklists", () => {
  function step(id: string, extra: Partial<Parameters<typeof blankTask>[0]> = {}) {
    return blankTask({ id, projectId: "proj-local", name: id, objective: `Do ${id}`, agentId: "agent-codex", position: { x: 0, y: 0 }, ...extra });
  }

  function board(): OrchestrationState {
    const actions: Action[] = [
      { type: "createTask", task: step("Rules") },
      { type: "createTask", task: step("Board"), dependsOn: [{ source: "Rules", gate: "verified" }] },
      { type: "createTask", task: step("Elsewhere") },
      { type: "createTask", task: step("Check it", { runner: "human", agentId: null, objective: "Check it" }), dependsOn: [{ source: "Board", gate: "verified" }] },
      { type: "setStatus", id: "Rules", status: "running" },
      { type: "updateTask", id: "Rules", patch: { output: "Moves are legal. Please check castling by eye.", filesChanged: ["src/rules.js"] } },
      { type: "setStatus", id: "Rules", status: "completed" },
      { type: "noteIssue", id: "Rules", text: "The replay link ignores hash changes." },
    ];
    return actions.reduce(reducer, workspace(1_000));
  }

  it("covers every step before the person's, in the order they ran, and nothing else", () => {
    const state = board();
    const input = checklistInput(state, state.tasks.find((task) => task.id === "Check it")!);
    expect(input.step).toEqual({ name: "Check it", objective: "" });
    expect(input.earlier.map((item) => item.name)).toEqual(["Rules", "Board"]);
    expect(input.earlier[0]).toEqual({
      name: "Rules",
      objective: "Do Rules",
      files: ["src/rules.js"],
      report: "Moves are legal. Please check castling by eye.",
      issues: ["The replay link ignores hash changes."],
    });
    expect(input.earlier[1]!.report).toBeUndefined();

    const prompt = checklistPrompt(input);
    expect(prompt).toContain("- Rules: Do Rules\n  Files it wrote: src/rules.js\n  What it reported:\n    Moves are legal.");
    expect(prompt).toContain("Known issues noted in it: The replay link ignores hash changes.");
    expect(prompt).toContain("The current directory is the project folder.");
    expect(prompt).not.toContain("What the step says now");
    expect(prompt).not.toContain("Elsewhere");
  });

  it("keeps what the person's step already says", () => {
    const state = reducer(board(), { type: "updateTask", id: "Check it", patch: { objective: "Try it on a phone too." } });
    expect(checklistPrompt(checklistInput(state, state.tasks.find((task) => task.id === "Check it")!))).toContain(
      "What the step says now. Keep whatever still applies:\nTry it on a phone too.",
    );
  });

  it("unwraps a fenced reply and refuses an empty one", () => {
    expect(parseChecklist("```text\nnpm start, then open http://localhost:8123\n1. Play a move.\n```")).toBe("npm start, then open http://localhost:8123\n1. Play a move.");
    expect(parseChecklist("  \n")).toEqual({ error: "The agent did not write a checklist." });
  });
});
