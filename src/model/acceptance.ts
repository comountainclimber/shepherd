import type { AcceptanceMark, Task } from "./types";

/** Content and occurrence keep repeated items separate without tying marks to their positions. */
export function acceptanceItems(acceptance: string[]) {
  const seen = new Map<string, number>();
  return acceptance.map((text, index) => {
    const occurrence = seen.get(text) ?? 0;
    seen.set(text, occurrence + 1);
    return { key: JSON.stringify([text, occurrence]), text, number: index + 1 };
  });
}

export function keptMarks(acceptance: string[], value: unknown, previous = acceptance): Record<string, AcceptanceMark> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const marks = value as Record<string, AcceptanceMark>;
  const kept = acceptanceItems(acceptance).flatMap(({ key, text }) => {
    const before = previous.filter((item) => item === text).length;
    const after = acceptance.filter((item) => item === text).length;
    // When duplicates change count, string items cannot tell us which occurrence survived.
    if (before !== after && Math.max(before, after) > 1) return [];
    const mark = marks[key];
    return mark && typeof mark.note === "string" && mark.note.trim() && typeof mark.at === "number" && Number.isFinite(mark.at)
      ? [[key, { note: mark.note.trim().slice(0, 500), at: mark.at }] as const] : [];
  });
  return kept.length ? Object.fromEntries(kept) : undefined;
}

export function markedCount(task: Task): number {
  return acceptanceItems(task.acceptance).filter(({ key }) => !!task.acceptanceMarks?.[key]).length;
}
