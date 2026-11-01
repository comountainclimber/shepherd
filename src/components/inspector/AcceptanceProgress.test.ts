import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { acceptanceItems } from "../../model/acceptance";
import { blankTask } from "../../model/factory";
import { AcceptanceCount, AcceptanceProgress } from "./AcceptanceProgress";

it("shows the same count during and after runs, with each item and the agent's evidence", () => {
  const acceptance = ["Page loads", "Works on mobile", "Links work", "Reload works"];
  const items = acceptanceItems(acceptance);
  const task = { ...blankTask({ id: "a", projectId: "proj-local", name: "Build", objective: "Build", agentId: "agent-codex", position: { x: 0, y: 0 }, acceptance }), acceptanceMarks: { [items[0].key]: { at: 1, note: "Loaded in Chrome" }, [items[1].key]: { at: 2, note: "Checked at 390px" } } };
  for (const status of ["running", "completed", "failed"] as const) {
    expect(renderToStaticMarkup(createElement(AcceptanceCount, { task: { ...task, status } }))).toContain("2 of 4");
  }
  const html = renderToStaticMarkup(createElement(AcceptanceProgress, { task }));
  for (const text of [...acceptance, "Agent says: met", "Not marked", "Loaded in Chrome", "Checked at 390px", "Checks decide"]) expect(html).toContain(text);
  for (const component of [AcceptanceProgress, AcceptanceCount]) {
    expect(renderToStaticMarkup(createElement(component, { task: { ...task, acceptance: [] } }))).toBe("");
    expect(renderToStaticMarkup(createElement(component, { task: { ...task, runner: "human" } }))).toBe("");
  }
});

it("puts the independent verdict and its reason next to the agent's claim", () => {
  const acceptance = ["Page loads"];
  const key = acceptanceItems(acceptance)[0].key;
  const task = blankTask({ id: "a", projectId: "proj-local", name: "Build", objective: "Build", agentId: "agent-codex", position: { x: 0, y: 0 }, acceptance, workCheck: true });
  task.acceptanceMarks = { [key]: { at: 1, note: "Loaded once" } };
  task.verification[0] = { ...task.verification[0], state: "failed", result: { items: [{ key, item: 1, verdict: "not met", reason: "Reload returns an error" }], unrequested: [], violations: [] } };
  const html = renderToStaticMarkup(createElement(AcceptanceProgress, { task }));
  for (const text of ["Agent says: met", "Loaded once", "Check: not met", "Reload returns an error"]) expect(html).toContain(text);
});
