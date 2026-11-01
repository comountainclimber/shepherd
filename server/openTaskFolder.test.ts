import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { workspace } from "../src/model/workspace";
import { openTaskFolder } from "./openTaskFolder";

const folder = mkdtempSync(path.join(tmpdir(), "shepherd-folder with spaces-"));
const board = workspace(1);
const id = board.goals[0]!.id;
board.goals[0] = { ...board.goals[0]!, folder };
afterAll(() => rmSync(folder, { recursive: true, force: true }));

describe("opening a task folder", () => {
  it("passes the saved path as one argument to Cursor or Finder without a shell", async () => {
    const launch = vi.fn().mockResolvedValue(undefined);
    expect(await openTaskFolder(board, id, "cursor", launch)).toEqual({ ok: true });
    expect(launch).toHaveBeenLastCalledWith("cursor", [folder]);
    expect(await openTaskFolder(board, id, "finder", launch)).toEqual({ ok: true });
    expect(launch).toHaveBeenLastCalledWith("open", [folder]);
  });
  it("refuses unknown tasks, commands and missing folders before launching", async () => {
    const launch = vi.fn();
    expect(await openTaskFolder(board, "missing", "cursor", launch)).toHaveProperty("error");
    expect(await openTaskFolder(board, id, "cursor; echo nope", launch)).toHaveProperty("error");
    expect(await openTaskFolder(workspace(1), id, "cursor", launch)).toHaveProperty("error");
    expect(
      await openTaskFolder({ ...board, goals: [{ ...board.goals[0]!, folder: path.join(folder, "missing") }] }, id, "finder", launch),
    ).toHaveProperty("error");
    writeFileSync(path.join(folder, "file"), "hi");
    expect(
      await openTaskFolder({ ...board, goals: [{ ...board.goals[0]!, folder: path.join(folder, "file") }] }, id, "finder", launch),
    ).toHaveProperty("error");
    expect(launch).not.toHaveBeenCalled();
  });
  it("explains how to recover when the cursor command is missing", async () => {
    const result = await openTaskFolder(board, id, "cursor", async () => {
      throw new Error("ENOENT");
    });
    expect(result).toEqual({ error: expect.stringContaining("Install the cursor command") });
  });
});
