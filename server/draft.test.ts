import { describe, expect, it } from "vitest";
import { blankTask } from "../src/model/factory";
import { reducer } from "../src/model/reducer";
import type { Action, OrchestrationState } from "../src/model/types";
import { workspace } from "../src/model/workspace";
import { MAP_RULES, MAX_DRAFT_STEPS, askArgs, checklistInput, codexError, checklistPrompt, draftPrompt, parseChecklist, parseDraft } from "./draft";

describe("draftPrompt", () => {
  it("includes the goal and shared map rules once, after asking to look around without changing files", () => {
    const prompt = draftPrompt("  Add a replay page.\n ");
    expect(prompt).toContain("Do not change any files; only plan.");
    expect(prompt).toContain("look around first so the steps fit what is there");
    expect(prompt).toContain("Goal:\nAdd a replay page.\n\nRules:");
    expect(prompt.split(MAP_RULES)).toHaveLength(2);
    expect(prompt).not.toContain("Fewer is better");
    expect(prompt).not.toContain("Steps run top to bottom");
  });

  it("defines independent siblings and a join using outline depth", () => {
    expect(MAP_RULES).toContain("touch different files and need nothing from each other");
    expect(MAP_RULES).toContain("at depth 1 under the step they both need");
    expect(MAP_RULES).toContain("run after that step and at the same time as each other");
    expect(MAP_RULES).toContain("comes after them at the left edge (depth 0), so it waits for all of them");
    expect(MAP_RULES).toContain("The first step has depth 0");
  });

  it("requires checkable work, acceptance, checks and a person's final step when needed", () => {
    expect(MAP_RULES).toContain("one sitting of work that ends in something checkable");
    expect(MAP_RULES).toContain("one to three Done when lines a reviewer can verify");
    expect(MAP_RULES).toContain("a check command when the repository has tests");
    expect(MAP_RULES).toContain("When a person has to look (a page, copy, a product call), the map ends with a step for a person that says what to try");
    expect(MAP_RULES).toContain("No step only plans or only reviews unless the goal asks for it");
    expect(MAP_RULES).toContain("Each step's name is a verb and the thing it changes");
    expect(MAP_RULES).toContain("Three to eight steps; one step only when the goal is a single small change");
  });

  it("asks for the agreed JSON shape and explains agent and human fields", () => {
    const prompt = draftPrompt("Add a replay page.");
    expect(prompt).toContain('"runner": "agent" or "human"; default to "agent"');
    expect(prompt).toContain('"acceptance": an array of the step\'s Done when lines');
    expect(prompt).toContain('"checkCommand": the repository command that checks the agent\'s work');
    expect(prompt).toContain("use an empty string when there are no tests");
    expect(prompt).toContain("use an empty string for a human step");
    expect(prompt).toContain("Reply with only this JSON and nothing else, no code fence:");
    const shape = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1).split("no code fence: ")[1]!);
    expect(shape).toEqual({
      steps: [{ name: "...", prompt: "...", depth: 0, runner: "agent", acceptance: ["..."], checkCommand: "" }],
    });
  });
});

describe("parseDraft", () => {
  it("reads the steps out of a reply with prose and a code fence around them", () => {
    const reply = 'Here is the plan:\n```json\n{"steps":[{"name":" Build it ","prompt":"Make it.","depth":1},{"name":"Test it","prompt":"","depth":1}]}\n```';
    expect(parseDraft(reply)).toEqual([
      { name: "Build it", prompt: "Make it.", depth: 0, runner: "agent", acceptance: [] },
      { name: "Test it", prompt: "", depth: 1, runner: "agent", acceptance: [] },
    ]);
  });

  it("drops steps with no name and treats an odd depth as the top level", () => {
    const reply = JSON.stringify({ steps: [{ name: "A", depth: 0 }, { prompt: "nameless" }, { name: "B", depth: 7 }] });
    expect(parseDraft(reply)).toEqual([
      { name: "A", prompt: "", depth: 0, runner: "agent", acceptance: [] },
      { name: "B", prompt: "", depth: 0, runner: "agent", acceptance: [] },
    ]);
  });

  it("keeps who does the step, Done when lines and a trimmed agent check command", () => {
    expect(parseDraft(JSON.stringify({ steps: [
      { name: "Build", runner: "agent", acceptance: [" Works ", "", null, 3, "  ", "Handles input", "Loads", "Saves", "Too many"], checkCommand: " npm test \n" },
      { name: "Try it", runner: "human", acceptance: [" Looks right "], checkCommand: "must not run" },
    ] }))).toEqual([
      { name: "Build", prompt: "", depth: 0, runner: "agent", acceptance: ["Works", "Handles input", "Loads", "Saves"], checkCommand: "npm test" },
      { name: "Try it", prompt: "", depth: 0, runner: "human", acceptance: ["Looks right"] },
    ]);
  });

  it("uses defaults for malformed optional values without losing the steps", () => {
    for (const bad of [null, 42, true, {}, [], "unexpected"]) {
      expect(parseDraft(JSON.stringify({ steps: [null, false, { name: "Build", runner: bad, acceptance: bad, checkCommand: bad }] }))).toEqual([
        { name: "Build", prompt: "", depth: 0, runner: "agent", acceptance: [], ...(typeof bad === "string" ? { checkCommand: bad } : {}) },
      ]);
    }
    expect(parseDraft(JSON.stringify({ steps: [{ name: "Build", checkCommand: " \n " }] }))).toEqual([
      { name: "Build", prompt: "", depth: 0, runner: "agent", acceptance: [] },
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

describe("codexError", () => {
  it("says what the API said, and whether it refused the model", () => {
    const stderr = [
      "2026-11-01T04:27:00.000Z ERROR codex_core: stream failed",
      'ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-6.1-sol\' model is not supported when using Codex with a ChatGPT account.","code":"model_not_found"}}',
    ].join("\n");
    expect(codexError(stderr)).toEqual({ text: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.", refusedModel: true });
    expect(codexError("Not logged in\n")).toEqual({ text: "Not logged in", refusedModel: false });
    expect(codexError("")).toEqual({ text: "", refusedModel: false });
  });
});

describe("askArgs", () => {
  it("asks read-only with the chosen model and thinking, or Codex's own default when there is none", () => {
    const picked = askArgs("Plan it", "/tmp/answer.txt", { model: "gpt-6-luna", effort: "low" });
    expect(picked.slice(0, 5)).toEqual(["exec", "-m", "gpt-6-luna", "-c", 'model_reasoning_effort="low"']);
    expect(picked).toEqual(expect.arrayContaining(["--sandbox", "read-only", "--ephemeral", "-o", "/tmp/answer.txt"]));
    expect(picked.at(-1)).toBe("Plan it");
    expect(askArgs("Plan it", "/tmp/answer.txt", {})).not.toContain("-m");
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
