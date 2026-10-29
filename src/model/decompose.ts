import { blankTask } from "./factory";
import type { Dependency, Gate, Task } from "./types";

export interface DecomposeOptions {
  projectId: string;
  rootTaskId: string | null;
  originX: number;
  nonce: number;
  agentIds: string[];
  takenWorktrees?: string[];
}

function shortTitle(text: string): string {
  const clause = text.split(/[.;:!?](?:\s|$)|,\s|\n/)[0]?.trim() || text;
  if (clause.length <= 48) return clause;
  const cut = clause.slice(0, 48);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 24 ? cut.lastIndexOf(" ") : 48)}…`;
}

function pick(agentIds: string[], index: number): string | null {
  if (!agentIds.length) return null;
  return agentIds[index % agentIds.length] ?? null;
}

function edge(source: string, target: string, gate: Gate): Dependency {
  return { id: `${source}->${target}`, source, target, gate };
}

export function proposeDecomposition(
  objective: string,
  opts: DecomposeOptions,
): { tasks: Task[]; dependencies: Dependency[] } {
  const text = objective.trim() || "Untitled task";
  const title = shortTitle(text);
  const taken = new Set(opts.takenWorktrees ?? []);
  const folder = (step: string) => (taken.has(step) ? `${step}-${opts.nonce}` : step);
  const steps = [
    {
      slug: "investigate",
      name: `Investigate: ${title}`,
      objective: `Read what is already in the current directory and write PLAN.md describing how to accomplish this objective. Do not implement it. Objective: ${text}`,
      acceptance: ["PLAN.md explains the approach", "Nothing is implemented yet"],
    },
    {
      slug: "implement",
      name: `Implement: ${title}`,
      objective: `Implement this objective, following the PLAN.md written by the investigate task. Objective: ${text}`,
      acceptance: [],
    },
    {
      slug: "verify",
      name: `Verify: ${title}`,
      objective: `Check the implementation against this objective without changing it. Run what you can, then write VERIFY.md with what you ran and what you saw. Objective: ${text}`,
      acceptance: ["VERIFY.md records what was run and the result"],
    },
  ];
  const tasks = steps.map((step, index) =>
    blankTask({
      id: `${opts.projectId}-${opts.nonce}-${step.slug}`,
      projectId: opts.projectId,
      name: step.name,
      objective: step.objective,
      description: text,
      acceptance: step.acceptance,
      agentId: pick(opts.agentIds, index),
      worktree: folder(step.slug),
      position: { x: opts.originX + index * 300, y: 24 },
    }),
  );
  const [investigate, implement, verify] = tasks as [Task, Task, Task];
  const dependencies = [
    edge(investigate.id, implement.id, "completed"),
    edge(implement.id, verify.id, "verified"),
  ];
  if (opts.rootTaskId) dependencies.unshift(edge(opts.rootTaskId, investigate.id, "verified"));
  return { tasks, dependencies };
}
