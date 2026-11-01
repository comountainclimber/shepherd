import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { expect, it } from "vitest";
import { blankTask } from "../../model/factory";
import type { TimelineEntry } from "../../runner/timeline";
import { TimelineRuns } from "./Timeline";

it("opens the newest run, folds earlier runs and commands, and shows checks and thumbnails", () => {
  const task = blankTask({ id: "step", name: "Build", objective: "Build", projectId: "proj-local", agentId: "agent-codex", position: { x: 0, y: 0 } });
  const entries: TimelineEntry[] = [
    { id: 1, run: 1, at: 1, kind: "run_started", text: "Started" },
    { id: 2, run: 1, at: 2, kind: "run_ended", text: "Failed: agent error", outcome: "failed" },
    { id: 3, run: 3, at: 3, kind: "run_started", text: "Resumed after a failed check" },
    { id: 4, run: 3, at: 4, kind: "note", text: "Checking the page" },
    ...[5, 6, 7, 8].map((id): TimelineEntry => ({ id, run: 3, at: id, kind: "command", commandId: String(id), text: `command-${id}` })),
    { id: 9, run: 3, at: 9, kind: "command_end", commandId: "5", text: "Exited 0" },
    { id: 10, run: 3, at: 10, kind: "screenshot", look: { file: "page.png", url: "http://localhost:5192", width: 390, height: 800, errors: [], at: 10 } },
    { id: 11, run: 3, at: 700_000, kind: "check_ended", ok: false, text: "npm test: Exited 1" },
  ];
  const html = renderToStaticMarkup(createElement(TimelineRuns, { entries, task, now: 700_000 }));
  expect(html.match(/data-timeline-run=/g)).toHaveLength(2);
  expect(html.match(/open=""/g)).toHaveLength(1);
  expect(html.indexOf("Resumed after a failed check")).toBeLessThan(html.indexOf("Failed: agent error"));
  expect(html).toContain("Ran 4 commands");
  expect(html).toContain("Checking the page");
  expect(html).toContain("Exited 0");
  expect(html).toContain("npm test: Exited 1");
  expect(html).toContain("Nothing for 11 minutes");
  expect(html).toContain('/api/looks/step/page.png');
});
