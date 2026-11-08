import { describe, expect, it } from "vitest";
import { mapShapeNote } from "./mapShape";

function map(count: number, arrows: [number, number][]) {
  return mapShapeNote(
    Array.from({ length: count }, (_, index) => ({ id: String(index) })),
    arrows.map(([source, target]) => ({ source: String(source), target: String(target) })),
  );
}

describe("mapShapeNote", () => {
  it("advises on a single step", () => {
    expect(map(1, [])).toBe("This map has one step. Steps that touch different files can run side by side. A person's step can close the task.");
  });

  it("leaves empty maps and short lines alone", () => {
    expect(map(0, [])).toBeUndefined();
    expect(map(2, [[0, 1]])).toBeUndefined();
    expect(map(3, [[0, 1], [1, 2]])).toBeUndefined();
  });

  it("advises on lines of four or more steps, even with redundant arrows or reversed board order", () => {
    expect(map(4, [[3, 2], [2, 1], [1, 0], [3, 0]])).toContain("straight line of 4 steps");
    expect(map(5, [[0, 1], [1, 2], [2, 3], [3, 4]])).toContain("straight line of 5 steps");
  });

  it("leaves branches, joins and independent steps alone", () => {
    expect(map(4, [[0, 1], [0, 2], [1, 3], [2, 3]])).toBeUndefined();
    expect(map(4, [[0, 2], [1, 2], [2, 3]])).toBeUndefined();
    expect(map(5, [[0, 1], [1, 2], [2, 3]])).toBeUndefined();
    expect(map(4, [])).toBeUndefined();
  });

  it("does not mistake a cycle for a line and ignores arrows outside the map", () => {
    expect(map(4, [[0, 1], [1, 2], [2, 3], [3, 0]])).toBeUndefined();
    expect(map(4, [[0, 1], [1, 2], [2, 3], [9, 0]])).toContain("straight line");
  });
});
