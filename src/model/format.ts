import type { Agent, TaskStatus } from "./types";
import { STATUS_LABEL } from "./types";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function formatClock(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatAgent(agent: Agent | undefined | null): string {
  if (!agent) return "Unassigned";
  return `${agent.name} · ${agent.model}`;
}

export function statusLabel(status: TaskStatus): string {
  return STATUS_LABEL[status];
}
