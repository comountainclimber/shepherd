import { describe, expect, it } from "vitest";
import { MAX_DRAFT_STEPS, parseDraft } from "./draft";

describe("parseDraft", () => {
  it("reads the steps out of a reply with prose and a code fence around them", () => {
    const reply = 'Here is the plan:\n```json\n{"steps":[{"name":" Build it ","prompt":"Make it.","depth":1},{"name":"Test it","prompt":"","depth":1}]}\n```';
    expect(parseDraft(reply)).toEqual([
      { name: "Build it", prompt: "Make it.", depth: 0 },
      { name: "Test it", prompt: "", depth: 1 },
    ]);
  });

  it("drops steps with no name and treats an odd depth as the top level", () => {
    const reply = JSON.stringify({ steps: [{ name: "A", depth: 0 }, { prompt: "nameless" }, { name: "B", depth: 7 }] });
    expect(parseDraft(reply)).toEqual([
      { name: "A", prompt: "", depth: 0 },
      { name: "B", prompt: "", depth: 0 },
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
