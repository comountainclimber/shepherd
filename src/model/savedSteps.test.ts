import { describe, expect, it } from "vitest";
import { newStep } from "./factory";
import type { ModelCatalog } from "./models";
import { outlineOf } from "./outline";
import { reducer } from "./reducer";
import { blockOf, changedFrom, fromSaved, placeAfter, readSavedSteps, relatives, STARTERS, toSavedItem, upsertSaved, withStarters } from "./savedSteps";
import type { OrchestrationState, SavedStep } from "./types";
import { workspace, WORKSPACE_PROJECT_ID } from "./workspace";

const NOW = 1_000_000;
const P = WORKSPACE_PROJECT_ID;
const G = `goal-${P}`;

function step(id: string) {
  return { ...newStep(P, `Do ${id}`), id, worktree: id };
}

/** An outline from indented ids, two spaces a level. */
function build(spec: string): OrchestrationState {
  const items = spec
    .trim()
    .split("\n")
    .map((line) => ({ id: line.trim(), depth: (line.length - line.trimStart().length) / 2 }));
  return reducer(workspace(NOW), { type: "addSteps", goalId: G, after: null, steps: items.map((item) => ({ task: step(item.id), depth: item.depth })) });
}

function task(state: OrchestrationState, id: string) {
  return state.tasks.find((candidate) => candidate.id === id)!;
}

const catalog: ModelCatalog = {
  codex: { models: [{ id: "gpt-here", name: "GPT-Here", hint: "", efforts: ["low", "high"] }], default: { model: "gpt-here", effort: "high" } },
  claude: { models: [], default: { model: null, effort: null } },
};

describe("readSavedSteps", () => {
  it("keeps what Shepherd can add to a project and drops the rest", () => {
    const list = readSavedSteps([
      {
        id: "good",
        name: "  Check it  ",
        version: 3,
        steps: [
          { name: "Look", runner: "agent", agentId: "agent-nobody", model: "--yolo", effort: "sideways", objective: "Go", acceptance: ["Works", "", 4], depth: 9 },
          { name: "  ", runner: "agent" },
          { name: "You look", runner: "human", agentId: "agent-codex", model: "gpt-here", review: true, independent: true, depth: 1 },
        ],
      },
      { id: "good", name: "Same id again", steps: [{ name: "x" }] },
      { id: "../escape", name: "Bad id", steps: [{ name: "x" }] },
      { id: "empty", name: "No steps", steps: [] },
      "not a saved step",
    ]);
    expect(list).toEqual([
      {
        id: "good",
        name: "Check it",
        version: 3,
        updatedAt: 0,
        steps: [
          { name: "Look", runner: "agent", agentId: "agent-codex", objective: "Go", description: "", acceptance: ["Works"], depth: 2 },
          { name: "You look", runner: "human", agentId: null, objective: "", description: "", acceptance: [], depth: 1 },
        ],
      },
    ]);
  });

  it("reads nothing from something that is not a list", () => {
    expect(readSavedSteps({ steps: [] })).toEqual([]);
    expect(readSavedSteps(null)).toEqual([]);
  });

  it("accepts the starters as they are", () => {
    expect(readSavedSteps(STARTERS)).toEqual(STARTERS);
  });

  it("offers a Codex merge request step and preserves its push option through saving and copying", () => {
    const saved = STARTERS.find((step) => step.id === "starter-merge-request")!;
    expect(saved.name).toBe("Open a merge request");
    expect(saved.steps[0]).toMatchObject({ runner: "agent", agentId: "agent-codex", pushBeforeRun: true });
    expect(saved.steps[0]!.objective).toContain("GitLab or GitHub");
    expect(saved.steps[0]!.objective).toContain("earlier steps' reports");
    expect(saved.steps[0]!.objective).toContain("conventions, templates");
    const copy = fromSaved(readSavedSteps([saved])[0]!, P, 0, catalog, () => "mr").steps[0]!.task;
    expect(copy.pushBeforeRun).toBe(true);
    expect(toSavedItem(copy, 0).pushBeforeRun).toBe(true);
    expect(changedFrom({ ...copy, pushBeforeRun: false }, saved)).toBe(true);
    expect(toSavedItem({ ...copy, runner: "human" }, 0).pushBeforeRun).toBeUndefined();
    expect(readSavedSteps([{ ...saved, steps: [{ ...saved.steps[0], runner: "human" }] }])[0]!.steps[0]!.pushBeforeRun).toBeUndefined();
  });
});

describe("toSavedItem", () => {
  it("keeps what to do and how, not what happened", () => {
    const state = build("a");
    const done = { ...task(state, "a"), model: "gpt-here", effort: "low" as const, checkCommand: " npm test ", acceptance: ["Loads", " "], status: "completed" as const, filesChanged: ["x.ts"] };
    expect(toSavedItem(done, 0)).toEqual({
      name: "Do a",
      runner: "agent",
      agentId: "agent-codex",
      model: "gpt-here",
      effort: "low",
      objective: "",
      description: "",
      acceptance: ["Loads"],
      checkCommand: "npm test",
      depth: 0,
    });
  });

  it("leaves out a person's checklist unless asked", () => {
    const person = { ...task(build("a"), "a"), runner: "human" as const, agentId: null, objective: "- Click save" };
    expect(toSavedItem(person, 0, false).objective).toBe("");
    expect(toSavedItem(person, 0, true).objective).toBe("- Click save");
  });
});

describe("relatives", () => {
  const state = build(`
a
  b
    b1
  c
  d
e`);

  it("offers the steps under a top-level step, and nothing side by side", () => {
    expect(relatives(state, "a")).toEqual({ siblings: [], children: ["b", "b1", "c", "d"] });
  });

  it("offers the steps side by side with an indented step, and its own sub-steps", () => {
    expect(relatives(state, "c")).toEqual({ siblings: ["b", "d"], children: [] });
    expect(relatives(state, "b")).toEqual({ siblings: ["c", "d"], children: ["b1"] });
  });
});

describe("blockOf", () => {
  const state = build(`
a
  b
    b1
  c
e`);

  it("saves a step and its sub-steps with the step at the top", () => {
    expect(blockOf(state, ["b1", "b"]).map((item) => [item.name, item.depth])).toEqual([
      ["Do b", 0],
      ["Do b1", 1],
    ]);
  });

  it("keeps steps that ran side by side indented, so they still run side by side", () => {
    expect(blockOf(state, ["c", "b"]).map((item) => [item.name, item.depth])).toEqual([
      ["Do b", 1],
      ["Do c", 1],
    ]);
  });

  it("asks per step whether to keep a person's checklist", () => {
    const withPerson = reducer(state, { type: "updateTask", id: "c", patch: { runner: "human", agentId: null, objective: "- Look" } });
    const block = blockOf(withPerson, ["b", "c"], (candidate) => candidate.id !== "c");
    expect(block.map((item) => item.objective)).toEqual(["", ""]);
  });
});

describe("placeAfter", () => {
  const state = build(`
a
  b
    b1
e`);

  it("adds past a step's own sub-steps, at its indent", () => {
    expect(placeAfter(state, G, "b")).toEqual({ after: "b1", depth: 1 });
    expect(placeAfter(state, G, "a")).toEqual({ after: "b1", depth: 0 });
  });

  it("adds at the end when there is no step to add after", () => {
    expect(placeAfter(state, G, null)).toEqual({ after: "e", depth: 0 });
    expect(placeAfter(state, G, "gone")).toEqual({ after: "e", depth: 0 });
    expect(placeAfter(workspace(NOW), P, null)).toEqual({ after: null, depth: 0 });
  });
});

describe("fromSaved", () => {
  const saved: SavedStep = {
    id: "saved-x",
    name: "Check twice",
    version: 4,
    updatedAt: 0,
    steps: [
      { name: "Look here", runner: "agent", agentId: "agent-codex", model: "gpt-here", effort: "low", objective: "Look", description: "", acceptance: [], review: true, depth: 0 },
      { name: "Look there", runner: "agent", agentId: "agent-codex", model: "gpt-elsewhere", objective: "", description: "", acceptance: [], depth: 1 },
      { name: "Deep", runner: "agent", agentId: "agent-codex", objective: "", description: "", acceptance: [], depth: 2 },
    ],
  };

  it("makes fresh queued copies that remember where they came from", () => {
    const { steps } = fromSaved(saved, P, 0, catalog, (index) => `new-${index}`);
    const first = steps[0]!.task;
    expect(first).toMatchObject({ id: "new-0", projectId: P, worktree: "new-0", status: "queued", model: "gpt-here", effort: "low", savedFrom: { id: "saved-x", version: 4 } });
    expect(first.git).toBeUndefined();
    expect(first.verification.map((check) => check.kind)).toEqual(["review"]);
  });

  it("drops a model this machine does not offer, and says which", () => {
    const { steps, unavailable } = fromSaved(saved, P, 0, catalog, (index) => `new-${index}`);
    expect(steps[1]!.task.model).toBeUndefined();
    expect(unavailable).toEqual(["gpt-elsewhere"]);
  });

  it("indents the block from where it is added, no deeper than the outline goes", () => {
    const { steps } = fromSaved(saved, P, 1, catalog, (index) => `new-${index}`);
    expect(steps.map((entry) => entry.depth)).toEqual([1, 2, 2]);
  });

  it("adds into the outline after the step it was placed after", () => {
    const state = build(`
a
  b
e`);
    const place = placeAfter(state, G, "a");
    const { steps } = fromSaved(saved, P, place.depth, catalog, (index) => `new-${index}`);
    const next = reducer(state, { type: "addSteps", goalId: G, after: place.after, steps });
    expect(outlineOf(next, G).map((item) => `${"  ".repeat(item.depth)}${item.id}`)).toEqual(["a", "  b", "new-0", "  new-1", "    new-2", "e"]);
  });
});

describe("changedFrom", () => {
  const [chrome, , yourself] = STARTERS;

  it("notices a change to anything the saved step keeps", () => {
    const { steps } = fromSaved(chrome!, P, 0, catalog, () => "copy");
    const copy = steps[0]!.task;
    expect(changedFrom(copy, chrome!)).toBe(false);
    expect(changedFrom({ ...copy, status: "completed", filesChanged: ["a.ts"] }, chrome!)).toBe(false);
    expect(changedFrom({ ...copy, description: "Runs on port 3000" }, chrome!)).toBe(true);
  });

  it("does not count the checklist Shepherd wrote for a person's copy", () => {
    const { steps } = fromSaved(yourself!, P, 0, catalog, () => "copy");
    expect(changedFrom({ ...steps[0]!.task, objective: "- Open the page" }, yourself!)).toBe(false);
  });
});

describe("upsertSaved and withStarters", () => {
  it("counts a new version when you save over one, and it is no longer a starter", () => {
    const list = upsertSaved(STARTERS, { ...STARTERS[0]!, name: "Check it in Chrome, slowly" }, 5);
    expect(list[0]).toMatchObject({ id: "starter-chrome", name: "Check it in Chrome, slowly", version: 2, updatedAt: 5 });
    expect(list[0]!.starter).toBeUndefined();
    expect(list).toHaveLength(STARTERS.length);
  });

  it("brings back only the starters you deleted", () => {
    const edited = upsertSaved([STARTERS[0]!], { ...STARTERS[0]!, name: "Mine now" }, 5);
    const back = withStarters(edited);
    expect(back.map((entry) => entry.id)).toEqual(STARTERS.map((entry) => entry.id));
    expect(back[0]!.name).toBe("Mine now");
  });
});
