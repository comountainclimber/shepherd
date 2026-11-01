import { describe, expect, it } from "vitest";
import { blankTask } from "./factory";
import { LOOK_LIMIT, reducer } from "./reducer";
import { needsMe, waitingOn } from "./selectors";
import { openIssues, stageHint } from "./stage";
import type { Action, Gate, OrchestrationState } from "./types";
import { dependencySatisfied, isFullyVerified } from "./verify";
import { workspace } from "./workspace";

const NOW = 1_000_000;

function make(id: string, extra: Partial<Parameters<typeof blankTask>[0]> = {}) {
  return blankTask({
    id,
    projectId: "proj-local",
    name: id,
    objective: `Do ${id}`,
    agentId: "agent-codex",
    position: { x: 0, y: 0 },
    review: true,
    ...extra,
  });
}

function apply(state: OrchestrationState, ...actions: Action[]) {
  return actions.reduce(reducer, state);
}

function task(state: OrchestrationState, id: string) {
  const found = state.tasks.find((item) => item.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

function chain(gate: Gate) {
  return apply(
    workspace(NOW),
    { type: "createTask", task: make("a") },
    { type: "createTask", task: make("b"), dependsOn: [{ source: "a", gate }] },
  );
}

function finishRun(state: OrchestrationState, id: string) {
  return apply(state, { type: "setStatus", id, status: "running" }, { type: "setStatus", id, status: "completed" });
}

function review(state: OrchestrationState, id: string, verdict: "passed" | "failed") {
  const check = task(state, id).verification.find((item) => item.kind === "review")!;
  return reducer(state, { type: "setCheck", taskId: id, checkId: check.id, state: verdict });
}

describe("verification", () => {
  it("does not verify a finished agent task until you accept it", () => {
    const state = finishRun(chain("verified"), "a");
    expect(task(state, "a").status).toBe("completed");
    expect(isFullyVerified(task(state, "a"))).toBe(false);
    expect(needsMe(task(state, "a"), state.tasks, state.dependencies)).toBe(true);

    const accepted = review(state, "a", "passed");
    expect(isFullyVerified(task(accepted, "a"))).toBe(true);
    expect(needsMe(task(accepted, "a"), accepted.tasks, accepted.dependencies)).toBe(false);
  });

  it("records which files you reviewed when you accept", () => {
    let state = finishRun(chain("verified"), "a");
    state = reducer(state, {
      type: "updateTask",
      id: "a",
      patch: { filesChanged: ["a/out.txt"] },
    });
    state = review(state, "a", "passed");
    expect(task(state, "a").verification[0]?.evidence).toBe("Accepted by you after reviewing a/out.txt.");
  });

  it("fails a finished task you reject, and a retry reopens the review", () => {
    let state = review(finishRun(chain("verified"), "a"), "a", "failed");
    expect(task(state, "a").status).toBe("failed");
    expect(task(state, "a").blocker).toMatch(/rejected/);

    state = reducer(state, { type: "setStatus", id: "a", status: "running" });
    expect(task(state, "a").status).toBe("running");
    expect(task(state, "a").verification[0]?.state).toBe("pending");
  });

  it("reopens the review when a verified task runs again", () => {
    let state = review(finishRun(chain("verified"), "a"), "a", "passed");
    state = reducer(state, { type: "setStatus", id: "a", status: "running" });
    expect(task(state, "a").verification[0]?.state).toBe("pending");
    expect(isFullyVerified(task(state, "a"))).toBe(false);
  });

  it("does not accept a review before the task has finished", () => {
    const state = review(chain("verified"), "a", "passed");
    expect(dependencySatisfied(state.dependencies[0]!, task(state, "a"))).toBe(false);
  });
});

describe("gates", () => {
  it("keeps the next task blocked until you verify the upstream task", () => {
    let state = reducer(chain("verified"), { type: "setStatus", id: "b", status: "running" });
    expect(task(state, "b").status).toBe("blocked");
    expect(task(state, "b").blocker).toBe("a has not finished");

    state = finishRun(state, "a");
    expect(task(state, "b").status).toBe("blocked");
    expect(task(state, "b").blocker).toBe("a is not done");

    state = review(state, "a", "passed");
    expect(task(state, "b").status).toBe("queued");
    expect(task(state, "b").blocker).toBeNull();
    expect(waitingOn(task(state, "b"), state.tasks, state.dependencies)).toBeNull();

    state = reducer(state, { type: "setStatus", id: "b", status: "running" });
    expect(task(state, "b").status).toBe("running");
  });

  it("opens a finished gate as soon as the upstream task finishes", () => {
    let state = reducer(chain("completed"), { type: "setStatus", id: "b", status: "running" });
    expect(task(state, "b").status).toBe("blocked");
    state = finishRun(state, "a");
    expect(task(state, "b").status).toBe("queued");
  });

  it("closes a verified gate again when you reject the upstream task", () => {
    let state = review(finishRun(chain("verified"), "a"), "a", "passed");
    expect(waitingOn(task(state, "b"), state.tasks, state.dependencies)).toBeNull();
    state = review(state, "a", "failed");
    expect(waitingOn(task(state, "b"), state.tasks, state.dependencies)).toBe("a has not finished");
  });

  it("refuses Mark complete on a human task while its gate is closed", () => {
    let state = apply(chain("verified"), {
      type: "createTask",
      task: make("ship", { runner: "human" }),
      dependsOn: [{ source: "a", gate: "verified" }],
    });
    state = reducer(state, { type: "setStatus", id: "ship", status: "completed" });
    expect(task(state, "ship").status).toBe("queued");
    expect(task(state, "ship").blocker).toBe("a has not finished");

    state = review(finishRun(state, "a"), "a", "passed");
    expect(task(state, "ship").blocker).toBeNull();
    expect(task(state, "ship").activity).toBe("Ready for you");

    state = reducer(state, { type: "setStatus", id: "ship", status: "completed" });
    expect(task(state, "ship").status).toBe("completed");
    expect(isFullyVerified(task(state, "ship"))).toBe(true);
  });

  it("keeps a failed task blocked on retry when its gate has closed", () => {
    let state = review(finishRun(chain("verified"), "a"), "a", "passed");
    state = apply(state, { type: "setStatus", id: "b", status: "running" }, { type: "setStatus", id: "b", status: "failed" });
    state = review(state, "a", "failed");
    state = reducer(state, { type: "setStatus", id: "b", status: "running" });
    expect(task(state, "b").status).toBe("blocked");
  });

  it("changes the gate on an existing edge instead of adding a second one", () => {
    let state = reducer(chain("completed"), { type: "connect", source: "a", target: "b", gate: "verified" });
    expect(state.dependencies).toHaveLength(1);
    expect(state.dependencies[0]?.gate).toBe("verified");
    state = reducer(state, { type: "connect", source: "a", target: "b" });
    expect(state.dependencies[0]?.gate).toBe("verified");
  });

  it("defaults a new edge to the verified gate", () => {
    const state = apply(
      workspace(NOW),
      { type: "createTask", task: make("a") },
      { type: "createTask", task: make("b") },
      { type: "connect", source: "a", target: "b" },
    );
    expect(state.dependencies[0]?.gate).toBe("verified");
  });

  it("frees a blocked task when you remove the edge", () => {
    let state = reducer(chain("verified"), { type: "setStatus", id: "b", status: "running" });
    state = reducer(state, { type: "disconnect", id: state.dependencies[0]!.id });
    expect(task(state, "b").status).toBe("queued");
    expect(task(state, "b").blocker).toBeNull();
  });

  it("does not count a failed upstream task as finished", () => {
    const state = review(finishRun(chain("verified"), "a"), "a", "passed");
    const failed = { ...task(state, "a"), status: "failed" as const };
    expect(dependencySatisfied(state.dependencies[0]!, failed)).toBe(false);
  });
});

describe("tasks", () => {
  it("gives a human task no agent and no checks", () => {
    const human = make("h", { runner: "human" });
    expect(human.agentId).toBeNull();
    expect(human.verification).toEqual([]);
  });

  it("gives an agent task a review only when asked", () => {
    expect(make("x").verification.map((check) => check.kind)).toEqual(["review"]);
    expect(make("y", { review: false }).verification).toEqual([]);
  });

  it("counts an agent step with no checks as done when it finishes", () => {
    let state = apply(workspace(NOW), { type: "createTask", task: make("a", { review: false }) }, {
      type: "createTask",
      task: make("b", { review: false }),
      dependsOn: [{ source: "a", gate: "verified" }],
    });
    state = finishRun(state, "a");
    expect(isFullyVerified(task(state, "a"))).toBe(true);
    expect(waitingOn(task(state, "b"), state.tasks, state.dependencies)).toBeNull();
  });

  it("turns the review on and off", () => {
    let state = apply(workspace(NOW), { type: "createTask", task: make("a", { review: false }) });
    state = reducer(state, { type: "setReview", id: "a", on: true });
    expect(task(state, "a").verification.map((check) => check.kind)).toEqual(["review"]);
    state = reducer(state, { type: "setReview", id: "a", on: false });
    expect(task(state, "a").verification).toEqual([]);
  });

  it("switches a step between an agent and you before it has run", () => {
    let state = apply(workspace(NOW), { type: "createTask", task: make("a") });
    state = reducer(state, { type: "reassign", id: "a", agentId: null, runner: "human" });
    expect(task(state, "a").runner).toBe("human");
    expect(task(state, "a").verification).toEqual([]);
    state = reducer(state, { type: "reassign", id: "a", agentId: "agent-claude", runner: "agent" });
    expect(task(state, "a").runner).toBe("agent");
    expect(task(state, "a").agentId).toBe("agent-claude");
  });

  it("asks for you on a human task once its gates are open", () => {
    const state = apply(workspace(NOW), { type: "createTask", task: make("h", { runner: "human" }) });
    expect(needsMe(task(state, "h"), state.tasks, state.dependencies)).toBe(true);
  });
});

describe("projects", () => {
  it("creates an empty project with its own folder", () => {
    let state = reducer(workspace(NOW), {
      type: "createProject",
      project: { id: "proj-2", name: "Notes", summary: "" },
    });
    state = reducer(state, {
      type: "createProject",
      project: { id: "proj-3", name: "Notes", summary: "" },
    });
    expect(state.projects.map((project) => project.directory)).toEqual(["workspace", "notes", "notes-2"]);
    expect(state.tasks).toEqual([]);
  });

  it("reset returns the empty workspace", () => {
    const state = reducer(chain("verified"), { type: "reset" });
    expect(state.projects.map((project) => project.id)).toEqual(["proj-local"]);
    expect(state.tasks).toEqual([]);
  });
});

describe("merging", () => {
  const GIT = { branch: "shepherd/a", folder: "/tmp/worktrees/a", target: "main", head: "1111111" };

  it("records the merge and forgets it when the task runs again", () => {
    let state = review(finishRun(chain("verified"), "a"), "a", "passed");
    state = apply(
      state,
      { type: "updateTask", id: "a", patch: { git: GIT } },
      { type: "merged", id: "a", into: "main", sha: "2222222" },
    );
    expect(task(state, "a").git?.merged).toEqual({ into: "main", sha: "2222222", at: state.now });
    expect(state.events.some((event) => event.message === "Merged a into main")).toBe(true);

    state = reducer(state, { type: "setStatus", id: "a", status: "running" });
    expect(task(state, "a").git).toEqual(GIT);
  });

  it("ignores a merge for a task that has no branch", () => {
    const state = finishRun(chain("verified"), "a");
    expect(reducer(state, { type: "merged", id: "a", into: "main", sha: "2222222" })).toBe(state);
  });
});

describe("check commands", () => {
  const COMMAND = "node implement/wc.mjs sample.txt";

  function checked(gate: Gate = "verified") {
    return apply(
      workspace(NOW),
      { type: "createTask", task: make("a", { checkCommand: COMMAND }) },
      { type: "createTask", task: make("b"), dependsOn: [{ source: "a", gate }] },
    );
  }

  function runCheck(state: OrchestrationState, id: string, exitCode: number | null, output = "", timedOut = false) {
    return apply(
      state,
      { type: "startCheck", taskId: id },
      { type: "recordCheck", taskId: id, run: { command: COMMAND, exitCode, output, durationMs: 1200, timedOut } },
    );
  }

  it("needs a passing check and your review before the task is verified", () => {
    let state = finishRun(checked(), "a");
    expect(task(state, "a").verification.map((check) => check.kind)).toEqual(["command", "review"]);
    state = review(state, "a", "passed");
    expect(isFullyVerified(task(state, "a"))).toBe(false);
    expect(waitingOn(task(state, "b"), state.tasks, state.dependencies)).toBe("a is not done");

    state = runCheck(state, "a", 0, "5\n");
    const check = task(state, "a").verification[0]!;
    expect(check.state).toBe("passed");
    expect(check.evidence).toBe(`${COMMAND} exited 0 in 1.2s.`);
    expect(check.output).toBe("5\n");
    expect(isFullyVerified(task(state, "a"))).toBe(true);
    expect(waitingOn(task(state, "b"), state.tasks, state.dependencies)).toBeNull();
  });

  it("fails the task when the check fails and keeps downstream closed", () => {
    let state = runCheck(finishRun(checked(), "a"), "a", 1, "Unable to read sample.txt");
    expect(task(state, "a").status).toBe("failed");
    expect(task(state, "a").blocker).toMatch(/^The check failed\. .* exited 1/);
    expect(task(state, "a").verification[0]!.exitCode).toBe(1);
    expect(needsMe(task(state, "a"), state.tasks, state.dependencies)).toBe(true);
    state = reducer(state, { type: "setStatus", id: "b", status: "running" });
    expect(task(state, "b").status).toBe("blocked");
  });

  it("restores a task that only failed its check once the check passes", () => {
    let state = runCheck(finishRun(checked(), "a"), "a", 1, "boom");
    state = runCheck(state, "a", 0, "ok");
    expect(task(state, "a").status).toBe("completed");
    expect(task(state, "a").blocker).toBeNull();
  });

  it("treats a timeout as a failure", () => {
    const state = runCheck(finishRun(checked(), "a"), "a", null, "", true);
    expect(task(state, "a").verification[0]!.evidence).toBe(`${COMMAND} timed out after 1.2s.`);
    expect(task(state, "a").status).toBe("failed");
  });

  it("ignores a result that arrives after a new run started", () => {
    let state = reducer(finishRun(checked(), "a"), { type: "startCheck", taskId: "a" });
    state = reducer(state, { type: "setStatus", id: "a", status: "running" });
    state = reducer(state, {
      type: "recordCheck",
      taskId: "a",
      run: { command: COMMAND, exitCode: 0, output: "", durationMs: 10 },
    });
    expect(task(state, "a").verification[0]!.state).toBe("pending");
    expect(task(state, "a").status).toBe("running");
  });

  it("sends a human task back to you when its check fails", () => {
    let state = apply(workspace(NOW), { type: "createTask", task: make("h", { runner: "human", checkCommand: COMMAND }) });
    state = reducer(state, { type: "setStatus", id: "h", status: "completed" });
    expect(isFullyVerified(task(state, "h"))).toBe(false);
    state = runCheck(state, "h", 2);
    expect(task(state, "h").status).toBe("queued");
    expect(task(state, "h").blocker).toMatch(/^The check failed/);
  });

  it("adds, changes, and removes the check", () => {
    let state = review(finishRun(chain("verified"), "a"), "a", "passed");
    expect(isFullyVerified(task(state, "a"))).toBe(true);
    state = reducer(state, { type: "setCheckCommand", id: "a", command: `  ${COMMAND} ` });
    expect(task(state, "a").checkCommand).toBe(COMMAND);
    expect(task(state, "a").verification[0]!.state).toBe("pending");
    expect(isFullyVerified(task(state, "a"))).toBe(false);
    state = reducer(state, { type: "setCheckCommand", id: "a", command: "" });
    expect(task(state, "a").checkCommand).toBeUndefined();
    expect(task(state, "a").verification.map((check) => check.kind)).toEqual(["review"]);
    expect(isFullyVerified(task(state, "a"))).toBe(true);
  });

  it("verifies a task without review by its check alone, and by finishing once the check goes", () => {
    let state = apply(
      workspace(NOW),
      { type: "createTask", task: make("a", { checkCommand: COMMAND, review: false }) },
      { type: "createTask", task: make("b"), dependsOn: [{ source: "a", gate: "verified" }] },
    );
    state = finishRun(state, "a");
    expect(isFullyVerified(task(state, "a"))).toBe(false);
    expect(state.notifications.at(-1)!.message).toBe("a finished. Its check decides whether it is done.");
    state = runCheck(state, "a", 0);
    expect(isFullyVerified(task(state, "a"))).toBe(true);
    expect(waitingOn(task(state, "b"), state.tasks, state.dependencies)).toBeNull();

    state = reducer(state, { type: "setCheckCommand", id: "a", command: "" });
    expect(task(state, "a").verification).toEqual([]);
    expect(isFullyVerified(task(state, "a"))).toBe(true);
  });
});

describe("known issues", () => {
  function noted() {
    const state = review(finishRun(chain("verified"), "a"), "a", "passed");
    return reducer(review(finishRun(state, "b"), "b", "passed"), { type: "noteIssue", id: "a", text: "  The replay link ignores later hash changes.  " });
  }

  it("keeps a problem on a finished step without reopening it", () => {
    const state = noted();
    const issues = task(state, "a").issues!;
    expect(issues).toEqual([{ id: issues[0]!.id, text: "The replay link ignores later hash changes.", at: NOW }]);
    expect(isFullyVerified(task(state, "a"))).toBe(true);
    expect(openIssues(task(state, "a"), state.tasks)).toHaveLength(1);
    expect(stageHint(task(state, "a"), "verified", state.tasks, state.dependencies)).toMatch(/^1 known issue · /);
    expect(state.events.at(-1)!.message).toBe("Known issue in a: The replay link ignores later hash changes.");
    expect(reducer(state, { type: "noteIssue", id: "a", text: "   " })).toBe(state);
  });

  it("drops an issue, and leaves no empty list behind", () => {
    const state = noted();
    const dropped = reducer(state, { type: "dropIssue", id: "a", issueId: task(state, "a").issues![0]!.id });
    expect(task(dropped, "a").issues).toBeUndefined();
  });

  it("turns an issue into a step at the end of the plan, open until that step is done", () => {
    let state = noted();
    const issue = task(state, "a").issues![0]!;
    const fix = make("fix", { review: false });
    state = reducer(state, { type: "fixIssue", id: "a", issueId: issue.id, task: fix });
    expect(task(state, "a").issues![0]!.stepId).toBe("fix");
    expect(state.goals.find((goal) => goal.id === "goal-proj-local")!.outline!.map((item) => item.id)).toEqual(["a", "b", "fix"]);
    expect(waitingOn(task(state, "fix"), state.tasks, state.dependencies)).toBeNull();
    expect(state.dependencies.filter((dep) => dep.target === "fix").map((dep) => dep.source)).toEqual(["b"]);
    expect(openIssues(task(state, "a"), state.tasks)).toHaveLength(1);
    expect(reducer(state, { type: "fixIssue", id: "a", issueId: issue.id, task: make("again") })).toBe(state);

    state = finishRun(state, "fix");
    expect(openIssues(task(state, "a"), state.tasks)).toEqual([]);
  });

  it("forgets the fix when its step is deleted, so the issue can be turned into a step again", () => {
    let state = noted();
    const issue = task(state, "a").issues![0]!;
    state = apply(state, { type: "fixIssue", id: "a", issueId: issue.id, task: make("fix") }, { type: "deleteTask", id: "fix" });
    expect(task(state, "a").issues![0]!.stepId).toBeUndefined();
    expect(reducer(state, { type: "fixIssue", id: "a", issueId: issue.id, task: make("again") }).tasks.some((item) => item.id === "again")).toBe(true);
  });
});

describe("models", () => {
  it("sets a step's model and thinking, and goes back to the defaults with null", () => {
    let state = reducer(chain("verified"), { type: "setModel", id: "a", model: "gpt-6-astra", effort: "max" });
    expect(task(state, "a")).toMatchObject({ model: "gpt-6-astra", effort: "max" });
    state = finishRun(state, "a");
    expect(state.events.find((event) => event.message.startsWith("Started a"))!.message).toBe("Started a with gpt-6-astra, max thinking");

    state = reducer(state, { type: "setModel", id: "a", model: null, effort: null });
    expect(task(state, "a").model).toBeUndefined();
    expect(task(state, "a").effort).toBeUndefined();
  });

  it("refuses a model that could pass for a flag, a person's step, and a running one", () => {
    const state = apply(chain("verified"), { type: "createTask", task: make("you", { runner: "human", agentId: null }) });
    expect(reducer(state, { type: "setModel", id: "a", model: "--yolo", effort: null })).toBe(state);
    expect(reducer(state, { type: "setModel", id: "you", model: "opus", effort: null })).toBe(state);
    const running = reducer(state, { type: "setStatus", id: "a", status: "running" });
    expect(reducer(running, { type: "setModel", id: "a", model: "gpt-6-luna", effort: null })).toBe(running);
  });

  it("forgets the model and the conversation when another agent takes the step", () => {
    let state = apply(
      chain("verified"),
      { type: "setModel", id: "a", model: "gpt-6-astra", effort: "high" },
      { type: "updateTask", id: "a", patch: { sessionId: "codex-session" } },
    );
    state = reducer(state, { type: "reassign", id: "a", agentId: "agent-claude", runner: "agent" });
    expect(task(state, "a")).toMatchObject({ agentId: "agent-claude", sessionId: null });
    expect(task(state, "a").model).toBeUndefined();
    expect(task(state, "a").effort).toBeUndefined();
  });
});

describe("screenshots", () => {
  it("keeps only the latest ones a step's agent took", () => {
    let state = chain("verified");
    for (let index = 0; index < LOOK_LIMIT + 3; index += 1) {
      state = reducer(state, { type: "looked", id: "a", look: { file: `${index}.png`, url: "http://localhost:8130/", width: 1280, height: 800, at: NOW, errors: [] } });
    }
    const looks = task(state, "a").looks!;
    expect(looks).toHaveLength(LOOK_LIMIT);
    expect(looks.at(-1)!.file).toBe(`${LOOK_LIMIT + 2}.png`);
    expect(looks[0]!.file).toBe("3.png");
  });
});
