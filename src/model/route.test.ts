import { describe, expect, it } from "vitest";
import { pathFor, placeFromPath, type Place } from "./route";

const routes: [string, Place][] = [
  ["/t/task-1", { goalId: "task-1", view: "canvas", stepId: null, tab: "step" }],
  ["/t/task-1/agents", { goalId: "task-1", view: "agents", stepId: null, tab: "step" }],
  ["/t/task-1/s/step-1", { goalId: "task-1", view: "canvas", stepId: "step-1", tab: "step" }],
  ["/t/task-1/s/step-1/output", { goalId: "task-1", view: "canvas", stepId: "step-1", tab: "output" }],
  ["/t/task-1/s/step-1/checks", { goalId: "task-1", view: "canvas", stepId: "step-1", tab: "checks" }],
  ["/t/task-1/s/step-1/log", { goalId: "task-1", view: "canvas", stepId: "step-1", tab: "log" }],
];

describe("routes", () => {
  it.each(routes)("round-trips %s", (path, place) => {
    expect(pathFor(place)).toBe(path);
    expect(placeFromPath(path)).toEqual(place);
    expect(pathFor(placeFromPath(path)!)).toBe(path);
    expect(placeFromPath(pathFor(place))).toEqual(place);
  });

  it.each(routes)("ignores a trailing slash on %s", (path, place) => {
    expect(placeFromPath(`${path}/`)).toEqual(place);
  });

  it.each(routes)("encodes and decodes ids in %s", (path, place) => {
    const goalId = "task /?#%+雪";
    const stepId = "step /?#%+🌱";
    const encoded = path.replace("task-1", "task%20%2F%3F%23%25%2B%E9%9B%AA")
      .replace("step-1", "step%20%2F%3F%23%25%2B%F0%9F%8C%B1");
    const withIds = { ...place, goalId, stepId: place.stepId === null ? null : stepId };
    expect(pathFor(withIds)).toBe(encoded);
    expect(placeFromPath(encoded)).toEqual(withIds);
  });

  it("decodes ids exactly once", () => {
    const place: Place = { goalId: "%2F", view: "canvas", stepId: "%20", tab: "step" };
    expect(pathFor(place)).toBe("/t/%252F/s/%2520");
    expect(placeFromPath(pathFor(place))).toEqual(place);
  });

  it("omits a retained step and tab in Agents view", () => {
    expect(pathFor({ goalId: "task-1", view: "agents", stepId: "step-1", tab: "log" })).toBe("/t/task-1/agents");
  });

  it("omits a retained tab when no step is selected", () => {
    expect(pathFor({ goalId: "task-1", view: "canvas", stepId: null, tab: "output" })).toBe("/t/task-1");
  });
});

describe("placeFromPath", () => {
  it.each(["unknown", "step", "OUTPUT", "%6Cog"])("opens the Step tab for tab %s", (tab) => {
    const expected: Place = { goalId: "task-1", view: "canvas", stepId: "step-1", tab: "step" };
    expect(placeFromPath(`/t/task-1/s/step-1/${tab}`)).toEqual(expected);
    expect(placeFromPath(`/t/task-1/s/step-1/${tab}/`)).toEqual(expected);
  });

  it.each([
    "/", "", "/t", "/t/", "/t//agents", "t/task-1", "/tasks/task-1", "/other",
    "/t/task-1/output", "/t/task-1/agents/step-1", "/t/task-1/s", "/t/task-1/s/",
    "/t/task-1/s//output", "/t/task-1/s/step-1/output/extra", "/t/task-1//",
    "/t/task-1/s/step-1//", "https://example.test/t/task-1",
  ])("returns null for unlisted path %s", (path) => {
    expect(placeFromPath(path)).toBeNull();
  });

  it.each(["/t/%", "/t/%ZZ/agents", "/t/%E0%A4%A/s/step-1", "/t/task-1/s/%", "/t/task-1/s/%FF/output"])(
    "returns null for malformed encoded ids in %s",
    (path) => {
      expect(placeFromPath(path)).toBeNull();
    },
  );
});
