import type { PanelTab, ViewId } from "./types";

export type Place = {
  goalId: string;
  view: ViewId;
  stepId: string | null;
  tab: PanelTab;
};

export function pathFor(place: Place): string {
  const base = `/t/${encodeURIComponent(place.goalId)}`;
  if (place.view === "agents") return `${base}/agents`;
  if (place.stepId === null) return base;
  const step = `${base}/s/${encodeURIComponent(place.stepId)}`;
  return place.tab === "step" ? step : `${step}/${place.tab}`;
}

export function placeFromPath(pathname: string): Place | null {
  const match = /^\/t\/([^/]+)(?:\/(agents)|\/s\/([^/]+)(?:\/([^/]+))?)?\/?$/.exec(pathname);
  if (!match) return null;
  const [, goalId, agents, stepId, tab] = match;
  try {
    return {
      goalId: decodeURIComponent(goalId),
      view: agents ? "agents" : "canvas",
      stepId: stepId === undefined ? null : decodeURIComponent(stepId),
      tab: tab === "output" || tab === "checks" || tab === "log" ? tab : "step",
    };
  } catch {
    return null;
  }
}
