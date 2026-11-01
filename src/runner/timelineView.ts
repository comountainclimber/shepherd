import type { TimelineEntry, TimelinePage } from "./timeline";

export function mergeTimeline(previous: TimelineEntry[], page: TimelinePage): TimelineEntry[] {
  const runs = page.runs ? new Set(page.runs) : undefined;
  const kept = new Map(previous.filter((entry) => entry.id >= page.first && entry.id <= page.cursor && (!runs || runs.has(entry.run))).map((entry) => [entry.id, entry]));
  for (const entry of page.entries) kept.set(entry.id, entry);
  return [...kept.values()].sort((a, b) => a.id - b.id);
}

export type TimelineRow =
  | { kind: "gap"; from: number; to: number }
  | { kind: "commands"; entries: TimelineEntry[] }
  | { kind: "entry"; entry: TimelineEntry };

export function timelineRows(entries: TimelineEntry[], until?: number): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const commands = new Set<string>();
  let previous: number | undefined;
  for (const entry of entries) {
    if (previous !== undefined && entry.at - previous > 600_000) rows.push({ kind: "gap", from: previous, to: entry.at });
    previous = entry.at;
    if (entry.kind === "command_end") continue;
    if (entry.kind === "command") {
      if (commands.has(entry.commandId)) continue;
      commands.add(entry.commandId);
      const last = rows.at(-1);
      if (last?.kind === "commands") last.entries.push(entry);
      else rows.push({ kind: "commands", entries: [entry] });
    } else rows.push({ kind: "entry", entry });
  }
  if (previous !== undefined && until !== undefined && until - previous > 600_000) rows.push({ kind: "gap", from: previous, to: until });
  return rows;
}

export function quietTime(from: number, to: number): string {
  const minutes = Math.floor((to - from) / 60_000);
  const hours = Math.floor(minutes / 60);
  const span = [hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "", minutes % 60 ? `${minutes % 60} ${minutes % 60 === 1 ? "minute" : "minutes"}` : ""].filter(Boolean).join(" ");
  const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `Nothing for ${span}, ${clock(from)} to ${clock(to)}`;
}
