import { describe, expect, it } from "vitest";
import { blankTask, newStep } from "./factory";
import { indent, moveBlock, moveDown, moveUp, normalize, outdent, outlineInputs, outlineOf, parseList } from "./outline";
import { reducer } from "./reducer";
import type { Action, OrchestrationState, OutlineItem } from "./types";
import { workspace, WORKSPACE_PROJECT_ID } from "./workspace";

const NOW = 1_000_000;
const P = WORKSPACE_PROJECT_ID;

function outline(spec: string): OutlineItem[] {
  return spec
    .trim()
    .split("\n")
    .map((line) => ({ id: line.trim(), depth: (line.length - line.trimStart().length) / 2 }));
}

function show(items: OutlineItem[] | null): string {
  return (items ?? []).map((item) => `${"  ".repeat(item.depth)}${item.id}`).join("\n");
}

function step(id: string) {
  return { ...newStep(P, id, `Do ${id}`), id, worktree: id };
}

function build(spec: string): OrchestrationState {
  const items = outline(spec);
  return reducer(workspace(NOW), { type: "addSteps", projectId: P, after: null, steps: items.map((item) => ({ task: step(item.id), depth: item.depth })) });
}

function apply(state: OrchestrationState, ...actions: Action[]) {
  return actions.reduce(reducer, state);
}

function arrows(state: OrchestrationState): string[] {
  return state.dependencies.map((dep) => `${dep.source}->${dep.target}${dep.outline ? "" : " (by hand)"}`).sort();
}

describe("outline shape", () => {
  it("indents at most one level past the step above, and never the first step", () => {
    expect(show(normalize(outline("  a\n      b\n  c")))).toBe("a\n  b\n  c");
  });

  it("runs top-level steps in order and indented steps side by side under their parent", () => {
    const inputs = outlineInputs(outline("plan\n  front\n  back\nship"));
    expect(Object.fromEntries(inputs)).toEqual({ plan: [], front: ["plan"], back: ["plan"], ship: ["front", "back"] });
  });

  it("makes a step under an indented step wait for it, and the next block wait for the ends", () => {
    const inputs = outlineInputs(outline("a\n  b\n    c\n  d\ne"));
    expect(inputs.get("c")).toEqual(["b"]);
    expect(inputs.get("d")).toEqual(["a"]);
    expect(inputs.get("e")).toEqual(["c", "d"]);
  });
});

describe("outline editing", () => {
  const items = outline("a\n  b\n  c\nd");

  it("indents a step under the one above, with its children", () => {
    expect(show(indent(outline("a\nb\n  c"), 1))).toBe("a\n  b\n    c");
    expect(indent(items, 0)).toBeNull();
    expect(indent(items, 1)).toBeNull();
  });

  it("outdents a step and what is under it", () => {
    expect(show(outdent(outline("a\n  b\n    c"), 1))).toBe("a\nb\n  c");
    expect(outdent(items, 0)).toBeNull();
  });

  it("moves a step past its sibling, keeping its children and its indent", () => {
    expect(show(moveDown(outline("a\n  x\nb\nc"), 0))).toBe("b\na\n  x\nc");
    expect(show(moveUp(items, 2))).toBe("a\n  c\n  b\nd");
    expect(moveUp(items, 1)).toBeNull();
    expect(moveDown(items, 2)).toBeNull();
  });

  it("drops a dragged block before another row at that row's indent", () => {
    expect(show(moveBlock(items, 3, 1))).toBe("a\n  d\n  b\n  c");
    expect(show(moveBlock(items, 0, 4))).toBe("d\na\n  b\n  c");
    expect(moveBlock(items, 0, 2)).toBeNull();
  });

  it("reads a pasted list with bullets, numbers and any indent width", () => {
    expect(parseList("1. Plan it\n   - Build the page\n   - Write tests\n2. Ship it\n\n")).toEqual([
      { name: "Plan it", depth: 0 },
      { name: "Build the page", depth: 1 },
      { name: "Write tests", depth: 1 },
      { name: "Ship it", depth: 0 },
    ]);
    expect(parseList("\ta\n\t\tb\n\t\t\t\tc").map((line) => line.depth)).toEqual([0, 1, 2]);
  });
});

describe("outline arrows", () => {
  it("draws the arrows the outline implies and lays the map out left to right", () => {
    const state = build("plan\n  front\n  back\nship");
    expect(arrows(state)).toEqual(["back->ship", "front->ship", "plan->back", "plan->front"]);
    const x = (id: string) => state.tasks.find((task) => task.id === id)!.position.x;
    expect([x("plan"), x("front"), x("back"), x("ship")]).toEqual([24, 324, 324, 624]);
  });

  it("redraws them when a step moves or is indented", () => {
    let state = build("a\nb\nc");
    state = reducer(state, { type: "setOutline", projectId: P, items: outline("a\n  b\n  c") });
    expect(arrows(state)).toEqual(["a->b", "a->c"]);
    state = reducer(state, { type: "setOutline", projectId: P, items: outline("c\na\nb") });
    expect(arrows(state)).toEqual(["a->b", "c->a"]);
  });

  it("inserts new steps after a given step, or at the top", () => {
    let state = build("a\nc");
    state = reducer(state, { type: "addSteps", projectId: P, after: "a", steps: [{ task: step("b"), depth: 0 }] });
    state = reducer(state, { type: "addSteps", projectId: P, after: null, steps: [{ task: step("first"), depth: 3 }] });
    expect(show(outlineOf(state, P))).toBe("first\na\nb\nc");
    expect(arrows(state)).toEqual(["a->b", "b->c", "first->a"]);
  });

  it("closes the gap when a step is deleted", () => {
    const state = reducer(build("a\nb\nc"), { type: "deleteTask", id: "b" });
    expect(show(outlineOf(state, P))).toBe("a\nc");
    expect(arrows(state)).toEqual(["a->c"]);
  });

  it("makes the next step wait for a step until it is done", () => {
    let state = apply(build("a\nb"), { type: "setStatus", id: "b", status: "running" });
    expect(state.tasks.find((task) => task.id === "b")!.status).toBe("blocked");
    state = apply(state, { type: "setStatus", id: "a", status: "running" }, { type: "setStatus", id: "a", status: "completed" });
    expect(state.tasks.find((task) => task.id === "b")!.status).toBe("queued");
  });

  it("keeps the arrows you draw by hand when the outline changes, until you follow the outline again", () => {
    let state = build("a\nb\nc");
    state = reducer(state, { type: "connect", source: "a", target: "c" });
    expect(arrows(state)).toEqual(["a->b", "a->c (by hand)", "b->c (by hand)"]);
    state = reducer(state, { type: "setOutline", projectId: P, items: outline("c\nb\na") });
    expect(arrows(state)).toEqual(["a->c (by hand)", "b->a", "b->c (by hand)"]);
    state = reducer(state, { type: "followOutline", id: "c" });
    expect(arrows(state)).toEqual(["b->a", "c->b"]);
  });

  it("turns removing an outline arrow into wiring that step by hand", () => {
    let state = build("a\nb");
    state = reducer(state, { type: "disconnect", id: state.dependencies[0]!.id });
    expect(state.dependencies).toEqual([]);
    expect(state.tasks.find((task) => task.id === "b")!.wired).toBe(true);
    state = reducer(state, { type: "addSteps", projectId: P, after: "b", steps: [{ task: step("c"), depth: 0 }] });
    expect(arrows(state)).toEqual(["b->c"]);
  });

  it("skips an outline arrow that would make a loop with arrows drawn by hand", () => {
    let state = build("a\nb");
    state = reducer(state, { type: "connect", source: "b", target: "a" });
    expect(arrows(state)).toEqual(["b->a (by hand)"]);
  });

  it("keeps an older project's hand-drawn arrows when it first gets an outline", () => {
    const legacy = (id: string) => blankTask({ id, projectId: P, name: id, objective: id, agentId: "agent-codex", position: { x: 0, y: 0 } });
    let state: OrchestrationState = { ...workspace(NOW), projects: workspace(NOW).projects.map(({ outline: _none, ...project }) => project) };
    state = apply(
      state,
      { type: "createTask", task: legacy("x") },
      { type: "createTask", task: legacy("y") },
      { type: "createTask", task: legacy("z"), dependsOn: [{ source: "x" }] },
    );
    expect(arrows(state)).toEqual(["x->z (by hand)"]);
    state = reducer(state, { type: "addSteps", projectId: P, after: "z", steps: [{ task: step("w"), depth: 0 }] });
    expect(show(outlineOf(state, P))).toBe("x\ny\nz\nw");
    expect(arrows(state)).toEqual(["x->z (by hand)", "z->w"]);
  });
});
