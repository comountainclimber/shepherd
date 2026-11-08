import type { Dependency, Task } from "./types";

export function mapShapeNote(steps: Pick<Task, "id">[], dependencies: Pick<Dependency, "source" | "target">[]): string | undefined {
  const advice = "Steps that touch different files can run side by side. A person's step can close the task.";
  if (steps.length === 1) return `This map has one step. ${advice}`;
  if (steps.length < 4) return undefined;

  const remaining = new Set(steps.map((step) => step.id));
  const inside = dependencies.filter((dep) => remaining.has(dep.source) && remaining.has(dep.target));
  while (remaining.size) {
    const ready = [...remaining].filter((id) => inside.every((dep) => dep.target !== id || !remaining.has(dep.source)));
    if (ready.length !== 1) return undefined;
    remaining.delete(ready[0]!);
  }
  return `This map is a straight line of ${steps.length} steps. ${advice}`;
}
