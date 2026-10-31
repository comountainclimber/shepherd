import type { Dependency, OrchestrationState, OutlineItem, Task } from "./types";

/** How far a step can be indented. */
export const MAX_DEPTH = 2;

const COLUMN = 300;
const ROW = 150;
const ORIGIN = 24;

/** Each step indented at most one level past the step above it, and the first step not at all. */
export function normalize(items: OutlineItem[]): OutlineItem[] {
  let previous = -1;
  return items.map((item) => {
    const depth = Math.max(0, Math.min(item.depth, previous + 1, MAX_DEPTH));
    previous = depth;
    return depth === item.depth ? item : { ...item, depth };
  });
}

/** Tasks in an order where every task comes after the ones it depends on; ties keep board order. */
export function dependencyOrder(tasks: Task[], deps: Dependency[]): Task[] {
  const ids = new Set(tasks.map((task) => task.id));
  const inside = deps.filter((dep) => ids.has(dep.source) && ids.has(dep.target));
  const placed = new Set<string>();
  const order: Task[] = [];
  while (order.length < tasks.length) {
    const next =
      tasks.find((task) => !placed.has(task.id) && inside.every((dep) => dep.target !== task.id || placed.has(dep.source))) ??
      tasks.find((task) => !placed.has(task.id))!;
    placed.add(next.id);
    order.push(next);
  }
  return order;
}

/** A project's steps in outline order. Steps added some other way, such as through the API, come last. */
export function outlineOf(state: OrchestrationState, projectId: string): OutlineItem[] {
  const tasks = state.tasks.filter((task) => task.projectId === projectId);
  const ids = new Set(tasks.map((task) => task.id));
  const stored = (state.projects.find((project) => project.id === projectId)?.outline ?? []).filter((item) => ids.has(item.id));
  const listed = new Set(stored.map((item) => item.id));
  const rest = dependencyOrder(
    tasks.filter((task) => !listed.has(task.id)),
    state.dependencies,
  ).map((task) => ({ id: task.id, depth: 0 }));
  return normalize([...stored, ...rest]);
}

/**
 * What each step waits for. Steps run top to bottom: an indented step waits for the step it sits
 * under, and a step at the left edge waits for everything in the block above it.
 */
export function outlineInputs(items: OutlineItem[]): Map<string, string[]> {
  const inputs = new Map<string, string[]>();
  items.forEach((item, index) => {
    if (item.depth > 0) {
      for (let above = index - 1; above >= 0; above -= 1) {
        if (items[above]!.depth < item.depth) {
          inputs.set(item.id, [items[above]!.id]);
          return;
        }
      }
    }
    let start = index - 1;
    while (start >= 0 && items[start]!.depth > 0) start -= 1;
    if (start < 0) {
      inputs.set(item.id, []);
      return;
    }
    const block = items.slice(start, index);
    const ends = block.filter((step, at) => at === block.length - 1 || block[at + 1]!.depth <= step.depth);
    inputs.set(
      item.id,
      ends.map((step) => step.id),
    );
  });
  return inputs;
}

function reaches(from: string, to: string, deps: { source: string; target: string }[]): boolean {
  const seen = new Set<string>([from]);
  for (let queue = [from]; queue.length; ) {
    const next = queue.shift()!;
    if (next === to) return true;
    for (const dep of deps) {
      if (dep.source === next && !seen.has(dep.target)) {
        seen.add(dep.target);
        queue.push(dep.target);
      }
    }
  }
  return false;
}

/**
 * Redraws the arrows the outline implies for every project that has an outline. A step wired by
 * hand keeps its own arrows, and an arrow that would make a loop is left out.
 */
export function syncOutlines(state: OrchestrationState): OrchestrationState {
  let next = state;
  for (const project of state.projects) {
    if (project.outline) next = syncProject(next, project.id);
  }
  return next;
}

function syncProject(state: OrchestrationState, projectId: string): OrchestrationState {
  const tasks = state.tasks.filter((task) => task.projectId === projectId);
  const ids = new Set(tasks.map((task) => task.id));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const ours = (dep: Dependency) => dep.outline && ids.has(dep.target);
  const kept = state.dependencies.filter((dep) => !ours(dep));
  const handWired = new Set(kept.filter((dep) => ids.has(dep.target)).map((dep) => dep.target));
  const wanted: Dependency[] = [];
  for (const [target, sources] of outlineInputs(outlineOf(state, projectId))) {
    if (byId.get(target)?.wired || handWired.has(target)) continue;
    for (const source of sources) {
      if (reaches(target, source, [...kept, ...wanted])) continue;
      wanted.push({ id: `${source}->${target}`, source, target, gate: "verified", outline: true });
    }
  }
  const before = state.dependencies.filter(ours).map((dep) => dep.id);
  if (before.length === wanted.length && wanted.every((dep, index) => dep.id === before[index])) return state;
  return { ...state, dependencies: [...kept, ...wanted] };
}

/**
 * Places a project's steps left to right in the order they run: each step one column past the
 * latest step it waits for, steps in the same column stacked in outline order and centred.
 */
export function layoutProject(state: OrchestrationState, projectId: string): OrchestrationState {
  const items = outlineOf(state, projectId);
  if (!items.length) return state;
  const ids = new Set(items.map((item) => item.id));
  const deps = state.dependencies.filter((dep) => ids.has(dep.source) && ids.has(dep.target));
  const tasks = state.tasks.filter((task) => ids.has(task.id));
  const column = new Map<string, number>();
  for (const task of dependencyOrder(tasks, deps)) {
    const inputs = deps.filter((dep) => dep.target === task.id).map((dep) => column.get(dep.source) ?? 0);
    column.set(task.id, inputs.length ? Math.max(...inputs) + 1 : 0);
  }
  const columns = new Map<number, string[]>();
  for (const item of items) {
    const at = column.get(item.id) ?? 0;
    columns.set(at, [...(columns.get(at) ?? []), item.id]);
  }
  const tallest = Math.max(...[...columns.values()].map((list) => list.length));
  const position = new Map<string, { x: number; y: number }>();
  for (const [at, list] of columns) {
    const offset = ((tallest - list.length) * ROW) / 2;
    list.forEach((id, row) => position.set(id, { x: ORIGIN + at * COLUMN, y: ORIGIN + offset + row * ROW }));
  }
  let moved = false;
  const nextTasks = state.tasks.map((task) => {
    const target = position.get(task.id);
    if (!target || (target.x === task.position.x && target.y === task.position.y)) return task;
    moved = true;
    return { ...task, position: target };
  });
  return moved ? { ...state, tasks: nextTasks } : state;
}

/** Where the block made of one step and everything indented under it ends (exclusive). */
export function subtreeEnd(items: OutlineItem[], index: number): number {
  const depth = items[index]?.depth ?? 0;
  let end = index + 1;
  while (end < items.length && items[end]!.depth > depth) end += 1;
  return end;
}

function shift(items: OutlineItem[], index: number, by: number): OutlineItem[] {
  const end = subtreeEnd(items, index);
  return items.map((item, at) => (at >= index && at < end ? { ...item, depth: Math.max(0, Math.min(MAX_DEPTH, item.depth + by)) } : item));
}

/** Indents a step and everything under it, so it runs alongside its siblings after the step above. */
export function indent(items: OutlineItem[], index: number): OutlineItem[] | null {
  const item = items[index];
  const above = items[index - 1];
  if (!item || !above || item.depth > above.depth || item.depth >= MAX_DEPTH) return null;
  return shift(items, index, 1);
}

export function outdent(items: OutlineItem[], index: number): OutlineItem[] | null {
  const item = items[index];
  if (!item || item.depth === 0) return null;
  return shift(items, index, -1);
}

/**
 * Moves a step and everything under it so it lands before the row now at `to` (or at the end), at
 * that row's indent unless told otherwise.
 */
export function moveBlock(items: OutlineItem[], from: number, to: number, indentTo?: number): OutlineItem[] | null {
  const end = subtreeEnd(items, from);
  if (from < 0 || from >= items.length || (to >= from && to <= end)) return null;
  const block = items.slice(from, end);
  const rest = [...items.slice(0, from), ...items.slice(end)];
  const at = to > from ? to - block.length : to;
  const depth = indentTo ?? rest[at]?.depth ?? 0;
  const delta = depth - block[0]!.depth;
  const moved = block.map((item) => ({ ...item, depth: item.depth + delta }));
  return normalize([...rest.slice(0, at), ...moved, ...rest.slice(at)]);
}

/** Swaps a step with the one above it at the same indent. */
export function moveUp(items: OutlineItem[], index: number): OutlineItem[] | null {
  const depth = items[index]?.depth ?? 0;
  for (let above = index - 1; above >= 0; above -= 1) {
    if (items[above]!.depth < depth) return null;
    if (items[above]!.depth === depth) return moveBlock(items, index, above, depth);
  }
  return null;
}

/** Swaps a step with the one below it at the same indent. */
export function moveDown(items: OutlineItem[], index: number): OutlineItem[] | null {
  const depth = items[index]?.depth ?? 0;
  const next = subtreeEnd(items, index);
  if (next >= items.length || items[next]!.depth !== depth) return null;
  return moveBlock(items, index, subtreeEnd(items, next), depth);
}

const BULLET = /^(?:[-*+•]|\d+[.)]|\[[ xX]\])\s+/;

/**
 * Reads pasted text as an outline: one step per line, indented by tabs or spaces, with any bullet
 * or number in front dropped.
 */
export function parseList(text: string): { name: string; depth: number }[] {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => {
      const lead = /^[ \t]*/.exec(line)![0];
      return { width: lead.replace(/\t/g, "    ").length, name: line.slice(lead.length).replace(BULLET, "").trim() };
    })
    .filter((line) => line.name);
  const widths = [...new Set(lines.map((line) => line.width))].sort((a, b) => a - b);
  return lines.map((line) => ({ name: line.name, depth: Math.min(widths.indexOf(line.width), MAX_DEPTH) }));
}
