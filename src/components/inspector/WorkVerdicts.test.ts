import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WorkVerdicts } from "./WorkVerdicts";

it("shows each verdict with reasons, prohibited work, and unrequested changes that alone do not fail", () => {
  const html = renderToStaticMarkup(createElement(WorkVerdicts, { result: {
    items: [
      { key: "a", item: 1, verdict: "met", reason: "The export exists" },
      { key: "b", item: 2, verdict: "not met", reason: "Missing mobile layout" },
      { key: "c", item: 3, verdict: "can't tell", reason: "Needs a signed-in browser" },
    ],
    unrequested: ["Reformatted another file"],
    violations: ["Deleted a file the step said to keep"],
  } }));
  for (const text of ["Done when 1: met", "The export exists", "Done when 2: not met", "Missing mobile layout", "tell", "Needs a signed-in browser", "Reformatted another file", "Deleted a file", "alone do not fail"]) expect(html).toContain(text);
});
