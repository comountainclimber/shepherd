import { describe, expect, it } from "vitest";
import { blankTask } from "../model/factory";
import { reducer } from "../model/reducer";
import type { Action, OrchestrationState } from "../model/types";
import { workspace } from "../model/workspace";
import { taskPrompt, upstreamContext } from "./prompt";

function step(id: string) {
  return blankTask({ id, projectId: "proj-local", name: id, objective: `Do ${id}`, agentId: "agent-codex", position: { x: 0, y: 0 } });
}

function board(...more: Action[]): OrchestrationState {
  const actions: Action[] = [
    { type: "createTask", task: step("a") },
    { type: "createTask", task: step("b"), dependsOn: [{ source: "a", gate: "verified" }] },
    { type: "setStatus", id: "a", status: "running" },
    { type: "setStatus", id: "a", status: "completed" },
    { type: "noteIssue", id: "a", text: "The replay link ignores hash changes." },
    ...more,
  ];
  return actions.reduce(reducer, workspace(1_000));
}

const get = (state: OrchestrationState, id: string) => state.tasks.find((task) => task.id === id)!;

describe("prompts", () => {
  it("tells the next step about known issues left in the work it builds on", () => {
    const state = board();
    const prompt = taskPrompt(get(state, "b"), undefined, upstreamContext(state, get(state, "b")));
    expect(prompt).toContain("  Known issues someone noted in its work and left for later:\n    - The replay link ignores hash changes.\nWhen you finish");
  });

  it("does not hand a fix step its own issue as something left for later", () => {
    let state = board({ type: "noteIssue", id: "b", text: "The board is lopsided." }, { type: "noteIssue", id: "b", text: "No sound." });
    const [lopsided] = get(state, "b").issues!;
    state = reducer(state, { type: "fixIssue", id: "b", issueId: lopsided!.id, task: step("fix") });
    expect(upstreamContext(state, get(state, "fix")).map((item) => [item.name, item.issues])).toEqual([["b", ["No sound."]]]);
  });

  it("explains both ways to look at a page only when Shepherd can take screenshots", () => {
    const task = get(board(), "b");
    expect(taskPrompt(task)).not.toContain("SHEPHERD_LOOK");
    const prompt = taskPrompt(task, undefined, [], { look: true });
    expect(prompt).toContain("First use your own browser tool, if you have one");
    expect(prompt).toContain("open a new tab for your page (without asking for it to be visible, which their Chrome cannot do) and leave their other tabs alone");
    expect(prompt).toContain('node "$SHEPHERD_LOOK" http://localhost:PORT/path');
  });

  it("asks an agent running a step again to do the work again, not repeat its last answer", () => {
    const task = get(board(), "b");
    const again = "You have worked on this step before in this conversation. Do the work again now";
    expect(taskPrompt(task)).not.toContain(again);
    expect(taskPrompt({ ...task, sessionId: "chat-1" })).toContain(again);
  });

  it("names the pushed task branch, remote and base, while forbidding agent commits and pushes", () => {
    const task = get(board(), "b");
    const prompt = taskPrompt(task, undefined, [], { pushed: { remote: "upstream", branch: "shepherd/fix", base: "release" } });
    expect(prompt).toContain("Shepherd has pushed the task branch shepherd/fix to remote upstream. Its base branch is release.");
    expect(prompt).toContain("glab, gh or your own tools");
    expect(prompt).toContain("Do not commit or push yourself");
    expect(prompt).toContain("full URL on its own line");
    expect(taskPrompt(task)).not.toContain("Shepherd has pushed");
  });

  it("gives a push-enabled step all its ancestors' reports once, in order, within its task", () => {
    let state = board({ type: "createTask", task: step("c"), dependsOn: [{ source: "b" }, { source: "a" }] });
    state = reducer(state, { type: "updateTask", id: "c", patch: { pushBeforeRun: true } });
    const context = upstreamContext(state, get(state, "c"));
    expect(context.map((item) => item.name)).toEqual(["a", "b"]);
    expect(context[0]?.summary).toBeTruthy();
    expect(upstreamContext(state, get(state, "b")).map((item) => item.name)).toEqual(["a"]);
  });
});
