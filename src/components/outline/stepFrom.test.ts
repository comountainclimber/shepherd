import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_ID } from "../../model/factory";
import { reducer } from "../../model/reducer";
import { workspace } from "../../model/workspace";
import { draftSteps } from "../../runner/live";
import { useShepherd } from "../../store";
import { stepFrom } from "./stepFrom";

afterEach(() => {
  vi.unstubAllGlobals();
  useShepherd.setState({ state: workspace(1) });
});

it("adds draft reply fields to outline steps, with command checks only for agents", async () => {
  const state = workspace(1);
  const goal = state.goals[0]!;
  useShepherd.setState({ state });
  const reply = [
    { name: "Build", prompt: "Build the page", depth: 0, runner: "agent", acceptance: ["Page loads", "Input works"], checkCommand: "npm test" },
    { name: "Try it", prompt: "Try the page on a phone", depth: 1, runner: "human", acceptance: ["Looks right"] },
  ];
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ steps: reply })));
  vi.stubGlobal("fetch", fetchMock);
  const result = await draftSteps(goal.id, "Make a page", {});
  expect(result).toEqual(reply);
  if (!Array.isArray(result)) throw new Error(result.error);
  const steps = result.map((step) => ({ task: stepFrom(goal.id, step.name, step.prompt, DEFAULT_AGENT_ID, "Make a page", step), depth: step.depth }));
  const next = reducer(state, { type: "addSteps", goalId: goal.id, after: null, steps });
  expect(next.goals[0]!.outline).toEqual(steps.map(({ task, depth }) => ({ id: task.id, depth })));
  expect(next.tasks[0]).toMatchObject({
    projectId: goal.projectId, goalId: goal.id, name: "Build", objective: "Build the page", description: "Make a page",
    runner: "agent", agentId: DEFAULT_AGENT_ID, acceptance: reply[0].acceptance, checkCommand: "npm test",
    verification: [{ kind: "command", state: "pending", command: "npm test" }],
  });
  expect(next.tasks[1]).toMatchObject({
    name: "Try it", objective: "Try the page on a phone", runner: "human", agentId: null, activity: "Waiting for you",
    acceptance: ["Looks right"], verification: [],
  });
  expect(next.tasks[1].checkCommand).toBeUndefined();
});

it("omits a person's command even if supplied and preserves plain pasted steps", () => {
  const state = workspace(1);
  useShepherd.setState({ state });
  const goalId = state.goals[0]!.id;
  const human = stepFrom(goalId, "Try it", "", DEFAULT_AGENT_ID, "", { runner: "human", checkCommand: "npm test", acceptance: ["Works"] });
  expect(human).toMatchObject({ runner: "human", agentId: null, acceptance: ["Works"], verification: [] });
  expect(human.checkCommand).toBeUndefined();
  const line = "A long pasted instruction that should keep all of its original text as the objective even when the title is shortened";
  const pasted = stepFrom(goalId, line, "", "agent-claude");
  expect(pasted).toMatchObject({ objective: line, description: "", runner: "agent", agentId: "agent-claude", acceptance: [], verification: [] });
  expect(pasted.name.length).toBeLessThanOrEqual(81);
});
