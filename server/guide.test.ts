import { describe, expect, it } from "vitest";
import { reducer } from "../src/model/reducer";
import { workspace } from "../src/model/workspace";
import { guideText } from "./guide";
import { planGoal, planTasks } from "./intake";

const origin = "http://127.0.0.1:6187";

describe("guideText", () => {
  it("names all five calls and points to the full API documentation", () => {
    const text = guideText(origin);
    for (const call of ["GET /api/tasks", "POST /api/goals", "POST /api/tasks", "POST /api/draft", "POST /api/commands"]) {
      expect(text).toContain(call);
    }
    expect(text).toContain("docs/api.md");
    expect(text.split("\n").length).toBeLessThan(80);
  });

  it("uses the supplied origin in every curl example", () => {
    for (const address of [origin, "http://localhost:7296"]) {
      const examples = [...guideText(address).matchAll(/```sh\n([\s\S]*?)\n```/g)].map((match) => match[1]);
      expect(examples).toHaveLength(5);
      for (const example of examples) {
        expect(example).toContain(`"${address}/api/`);
        expect(example).toContain("Authorization: Bearer $TOKEN");
      }
    }
  });

  it("explains session authentication without embedding a token value", () => {
    const text = guideText(origin);
    expect(text).toContain("session.json");
    expect(text).toContain("Authorization: Bearer <token>");
    expect(text).not.toMatch(/[a-f0-9]{64}/i);
  });

  it("uses creation payloads accepted by the intake contract", () => {
    const payloads = [...guideText(origin).matchAll(/-d '([\s\S]*?)'/g)].map((match) => JSON.parse(match[1]));
    expect(payloads).toHaveLength(4);
    const initial = workspace(1);
    const plannedGoal = planGoal(initial, { ...payloads[0], project: initial.projects[0].id }, "guide-goal");
    if ("error" in plannedGoal) throw new Error(plannedGoal.error);
    const state = reducer(initial, plannedGoal.action);
    const planned = planTasks(state, { ...payloads[1], goal: plannedGoal.goal.id }, (index) => `guide-step-${index}`);
    if ("error" in planned) throw new Error(planned.error);
    expect(planned.tasks).toHaveLength(3);
    const added = planned.actions.reduce(reducer, state);
    expect(added.dependencies.map(({ source, target, gate }) => ({ source, target, gate }))).toEqual([
      { source: "guide-step-0", target: "guide-step-1", gate: "verified" },
      { source: "guide-step-1", target: "guide-step-2", gate: "verified" },
    ]);
    for (const step of added.tasks.filter((step) => step.runner === "agent")) {
      expect(step.acceptance.length).toBeGreaterThan(0);
      expect(step.checkCommand).toBe("npm test");
    }
    expect(added.tasks[2].runner).toBe("human");
    expect(payloads[2]).toEqual({ goal: "<task id>" });
    expect(payloads[3]).toEqual({ command: "runPlan", goalId: "<task id>" });
  });
});
