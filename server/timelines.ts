import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TimelineEntry, TimelineEvent, TimelinePage } from "../src/runner/timeline";

export const TIMELINE_LIMIT = 1_000_000;
const ENTRY_LIMIT = 24_000;

export function createTimelines(root: string, clock: () => number = Date.now, limit = TIMELINE_LIMIT) {
  function file(id: string) {
    if (!/^[\w.-]{1,120}$/.test(id) || id === "." || id === "..") throw new Error("Not a usable step id.");
    return path.join(root, `${id}.jsonl`);
  }
  function read(id: string) {
    const target = file(id);
    const text = existsSync(target) ? readFileSync(target, "utf8") : "";
    let cursor = 0;
    const entries: TimelineEntry[] = [];
    for (const line of text.split("\n")) {
      try {
        const value = JSON.parse(line);
        if (typeof value?.id === "number") {
          entries.push(value as TimelineEntry);
          cursor = Math.max(cursor, value.id);
        } else if (typeof value?.cursor === "number") cursor = Math.max(cursor, value.cursor);
      } catch { /* An interrupted append can leave a partial last line. */ }
    }
    return { entries, cursor, complete: !text || text.endsWith("\n") };
  }
  function append(id: string, event: TimelineEvent, run?: number): TimelineEntry {
    const saved = read(id);
    const seq = saved.cursor + 1;
    const latestRun = saved.entries.reduce((latest, entry) => Math.max(latest, entry.run), 0);
    const entry: TimelineEntry = { ...bound(event), id: seq, run: event.kind === "run_started" ? seq : run ?? (latestRun || seq), at: clock() };
    mkdirSync(root, { recursive: true });
    const target = file(id);
    const evictedRun = run !== undefined && run < latestRun && !saved.entries.some((item) => item.run === run);
    appendFileSync(target, `${saved.complete ? "" : "\n"}${JSON.stringify(evictedRun ? { cursor: seq } : entry)}\n`);
    if (statSync(target).size > limit) {
      let kept = [...saved.entries, ...(evictedRun ? [] : [entry])].map((item) => ({ entry: item, line: JSON.stringify(item) + "\n" }));
      // A late check can finish for an older run after a new agent has started.
      const runs = [...new Set(kept.map((item) => item.entry.run))].sort((a, b) => a - b);
      const header = JSON.stringify({ cursor: seq }) + "\n";
      let size = Buffer.byteLength(header) + kept.reduce((total, item) => total + Buffer.byteLength(item.line), 0);
      while (size > limit && runs.length > 1) {
        const oldest = runs.shift();
        kept = kept.filter((item) => {
          if (item.entry.run !== oldest) return true;
          size -= Buffer.byteLength(item.line);
          return false;
        });
      }
      // A single very long run must also stay bounded.
      while (size > limit && kept.length > 1) size -= Buffer.byteLength(kept.shift()!.line);
      const temp = `${target}.tmp`;
      writeFileSync(temp, header + kept.map((item) => item.line).join(""));
      renameSync(temp, target);
    }
    return entry;
  }
  return {
    append,
    read(id: string, after = 0): TimelinePage {
      const { entries, cursor } = read(id);
      return { entries: entries.filter((entry) => entry.id > after), cursor, first: entries[0]?.id ?? 0, runs: [...new Set(entries.map((entry) => entry.run))] };
    },
    delete(id: string) { rmSync(file(id), { force: true }); },
  };
}

function bound(event: TimelineEvent): TimelineEvent {
  if (event.kind === "check_ended") return { ...event, text: event.text.slice(0, 2000), ...(event.detail ? { detail: event.detail.slice(-ENTRY_LIMIT) } : {}) };
  if ("text" in event) return { ...event, text: event.text.slice(0, ENTRY_LIMIT) };
  if (event.kind === "files") return { ...event, files: event.files.join("\n").slice(0, ENTRY_LIMIT).split("\n") };
  return { ...event, look: { ...event.look, url: event.look.url.slice(0, 2000), errors: event.look.errors.slice(0, 10).map((error) => error.slice(0, 500)) } };
}

export type Timelines = ReturnType<typeof createTimelines>;
