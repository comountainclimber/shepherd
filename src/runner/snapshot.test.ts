import { describe, expect, it } from "vitest";
import { changedPaths } from "./snapshot";

describe("changedPaths", () => {
  it("returns files that were created or rewritten", () => {
    expect(
      changedPaths(
        [{ path: "keep.txt", size: 4, mtimeMs: 1 }],
        [
          { path: "keep.txt", size: 4, mtimeMs: 1 },
          { path: "beacon.txt", size: 7, mtimeMs: 2 },
        ],
      ),
    ).toEqual(["beacon.txt"]);
  });

  it("notices a rewrite of an existing file", () => {
    expect(
      changedPaths([{ path: "note.txt", size: 3, mtimeMs: 1 }], [{ path: "note.txt", size: 3, mtimeMs: 2 }]),
    ).toEqual(["note.txt"]);
  });
});
