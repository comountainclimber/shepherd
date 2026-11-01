import { describe, expect, it } from "vitest";
import { mergeRequestUrl, reportedMergeRequest } from "./mergeRequest";
import { loadState } from "./migrate";
import { newStep } from "./factory";
import { workspace } from "./workspace";

describe("reported merge requests", () => {
  it("accepts GitLab, GitHub and private hosts from plain or Markdown reports", () => {
    for (const url of ["https://gitlab.example.test/group/sub/repo/-/merge_requests/23", "https://github.com/org/repo/pull/42", "https://github.example.test/org/repo/pull/1"]) {
      expect(reportedMergeRequest(`Opened [the request](${url}).`)).toBe(url);
      expect(reportedMergeRequest(`Updated it.\n${url}\n`)).toBe(url);
    }
    expect(reportedMergeRequest("Compared https://github.com/o/r/pull/1\nhttps://github.com/o/r/pull/2")).toBe("https://github.com/o/r/pull/2");
  });

  it("ignores unrelated links and unsafe URLs", () => {
    for (const value of ["javascript:alert(1)", "https://example.test", "https://github.com/o/r/issues/1", "https://user:secret@github.com/o/r/pull/1", "https://github.com/o/r/pull/1/files", undefined]) {
      expect(mergeRequestUrl(value)).toBeNull();
    }
    expect(reportedMergeRequest("No merge request could be created.")).toBeNull();
  });

  it("keeps the push option and task link after reloading the board", () => {
    const board = workspace(1);
    const url = "https://gitlab.example.test/g/r/-/merge_requests/7";
    board.goals[0]!.mergeRequestUrl = url;
    board.tasks = [{ ...newStep(board.projects[0]!.id, "MR"), pushBeforeRun: true }];
    const loaded = loadState(board)!;
    expect(loaded.goals[0]!.mergeRequestUrl).toBe(url);
    expect(loaded.tasks[0]!.pushBeforeRun).toBe(true);
    board.goals[0]!.mergeRequestUrl = "javascript:alert(1)";
    expect(loadState(board)!.goals[0]!.mergeRequestUrl).toBeUndefined();
  });
});
