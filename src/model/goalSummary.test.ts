import { expect, it } from "vitest";
import { blankGoal, newStep } from "./factory";
import { goalSummary } from "./goals";
import { workspace } from "./workspace";

it("counts accepted steps and attention within each task, including dirty-folder waits", () => {
  const state = workspace(1);
  const goal = state.goals[0]!;
  const other = blankGoal(goal.projectId, "Other", "other");
  state.goals.push(other);
  const done = { ...newStep(goal.projectId, "Done", "", "agent-codex", goal.id), status: "completed" as const, verification: [] };
  const review = {
    ...newStep(goal.projectId, "Review", "", "agent-codex", goal.id),
    status: "completed" as const,
    verification: [{ id: "review", kind: "review" as const, state: "pending" as const, timestamp: null, evidence: "" }],
  };
  state.tasks = [done, review, { ...newStep(goal.projectId, "Running elsewhere", "", "agent-codex", other.id), status: "running" }];
  expect(goalSummary(state, goal)).toMatchObject({ done: 1, total: 2, running: false, needsYou: true });
  expect(goalSummary(state, other)).toMatchObject({ done: 0, total: 1, running: true, needsYou: false });
  expect(goalSummary(state, { ...other, running: true, blocker: "Waiting for uncommitted changes" })).toMatchObject({
    running: true,
    needsYou: true,
  });
});
