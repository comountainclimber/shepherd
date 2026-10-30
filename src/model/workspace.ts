import { slugify } from "./factory";
import type { Agent, OrchestrationState, Project } from "./types";

export const WORKSPACE_PROJECT_ID = "proj-local";

export const CODEX_MODEL = "gpt-5.6-terra";

export const AGENTS: Agent[] = [
  { id: "agent-claude", name: "Claude Code", provider: "claude-code", model: "default model" },
  { id: "agent-codex", name: "Codex", provider: "codex", model: CODEX_MODEL },
];

export function agentById(id: string | null | undefined): Agent | undefined {
  return AGENTS.find((agent) => agent.id === id);
}

export function projectDirectory(name: string, projects: Project[]): string {
  const base = slugify(name, "project");
  const taken = new Set(projects.map((project) => project.directory).filter(Boolean));
  let directory = base;
  for (let index = 2; taken.has(directory); index += 1) directory = `${base}-${index}`;
  return directory;
}

export function workspace(now = Date.now()): OrchestrationState {
  return {
    schema: 2,
    projects: [
      {
        id: WORKSPACE_PROJECT_ID,
        name: "Workspace",
        summary: "Tasks you add here run with Claude Code or Codex, each on its own branch of this project's repository.",
        directory: "workspace",
      },
    ],
    tasks: [],
    dependencies: [],
    events: [],
    notifications: [],
    now,
    seq: 1,
  };
}

export function isDemoState(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;
  const projects = (state as { projects?: unknown }).projects;
  if (!Array.isArray(projects)) return false;
  return projects.some((project) => {
    const id = project && typeof project === "object" ? (project as { id?: unknown }).id : "";
    return id === "proj-checkout" || id === "proj-search";
  });
}
