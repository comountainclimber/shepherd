import { describe, expect, it } from "vitest";
import { blankTask } from "../model/factory";
import { reducer } from "../model/reducer";
import type { Action, OrchestrationState } from "../model/types";
import { workspace } from "../model/workspace";
import { taskPrompt, upstreamContext } from "./prompt";
import { acceptanceItems } from "../model/acceptance";

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
  it("puts conflict guidance after the task branch and names its source, files and accepted steps", () => {
    const prompt = taskPrompt(step("a"), undefined, [], {
      taskBranch: "shepherd/fix",
      conflict: {
        source: "shepherd/fix",
        files: ["src/runner/prompt.ts", "src/runner/prompt.test.ts"],
        steps: ["Add merge recovery", "Track accepted work"],
      },
    });
    expect(prompt).toContain("This step belongs to task branch shepherd/fix. Accepted work collects there; the project checkout stays untouched.\nResolve the merge conflict before continuing:");
    expect(prompt).toContain("Shepherd merged shepherd/fix into this worktree and git could not combine it with this step's work.");
    expect(prompt).toContain("Files with conflict markers:\n- src/runner/prompt.ts\n- src/runner/prompt.test.ts");
    expect(prompt).toContain("Accepted steps that changed the same files: Add merge recovery, Track accepted work.");
    expect(prompt).toContain("Resolve every conflict so this step's change and the other work both survive and still fit together. Remove every conflict marker.");
    expect(prompt).toContain("Do not run git merge --abort. Do not run git reset or git checkout on these files. Do not commit; Shepherd concludes the merge when you finish.");
    expect(prompt).toContain("Then finish this step's own objective and run its check as usual.");
  });

  it("leaves the prompt unchanged without a conflict", () => {
    const task = step("a");
    const expected = [
      "You are doing one step of a plan that Shepherd runs with several agents.",
      "Work only in the current directory. It is this step's own git worktree, so other steps cannot see or overwrite your changes.",
      "Shepherd commits your changes when you finish. Do not commit, push, or switch branches yourself.",
      "This step belongs to task branch shepherd/fix. Accepted work collects there; the project checkout stays untouched.",
      "Task: a",
      "Objective: Do a",
      "When you finish, summarize what changed and how to verify it.",
    ].join("\n");
    expect(taskPrompt(task, undefined, [], { taskBranch: "shepherd/fix" })).toBe(expected);
    expect(taskPrompt(task, undefined, [], { taskBranch: "shepherd/fix", conflict: undefined })).toBe(expected);
    expect(taskPrompt(task)).not.toContain("Resolve the merge conflict");
  });

  it("omits the accepted steps clause when no steps changed the conflicted files", () => {
    const prompt = taskPrompt(step("a"), undefined, [], {
      conflict: { source: "shepherd/fix", files: ["src/runner/prompt.ts"], steps: [] },
    });
    expect(prompt).toContain("Resolve the merge conflict before continuing:");
    expect(prompt).toContain("Shepherd merged shepherd/fix");
    expect(prompt).toContain("Files with conflict markers:\n- src/runner/prompt.ts");
    expect(prompt).not.toContain("Accepted steps that changed the same files");
  });

  it("numbers Done when items and asks for evidence as each is confirmed, with a way to withdraw", () => {
    const task = { ...step("a"), acceptance: ["Page loads", "Works on mobile"] };
    const prompt = taskPrompt(task, undefined, [], { done: true });
    expect(prompt).toContain("Done when:\n1. Page loads\n2. Works on mobile");
    expect(prompt).toContain('node "$SHEPHERD_DONE" ITEM "Short note on how you know"');
    expect(prompt).toContain("as you confirm them, not all at the end");
    expect(prompt).toContain('node "$SHEPHERD_DONE" ITEM --undo');
    expect(prompt).toContain("from its checks");
    expect(taskPrompt(task)).not.toContain("SHEPHERD_DONE");
    expect(taskPrompt(step("empty"), undefined, [], { done: true })).not.toContain("SHEPHERD_DONE");
    const key = acceptanceItems(task.acceptance)[0].key;
    expect(taskPrompt({ ...task, sessionId: "chat", acceptanceMarks: { [key]: { at: 1, note: "Opened it in Chrome" } } }, undefined, [], { done: true })).toContain("You previously marked this as met: Opened it in Chrome");
  });
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
