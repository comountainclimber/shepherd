import type { Look } from "../model/types";

export type TimelineEvent =
  | { kind: "run_started"; text: string }
  | { kind: "run_ended"; text: string; outcome: "completed" | "failed" | "stopped" }
  | { kind: "note" | "report" | "wait"; text: string }
  | { kind: "command"; commandId: string; text: string }
  | { kind: "command_end"; commandId: string; text: string }
  | { kind: "files"; files: string[] }
  | { kind: "screenshot"; look: Look }
  | { kind: "check_started"; text: string }
  | { kind: "check_ended"; text: string; ok: boolean; detail?: string };

export type TimelineEntry = TimelineEvent & { id: number; run: number; at: number };
export interface TimelinePage {
  entries: TimelineEntry[];
  cursor: number;
  /** Entries older than this id have been removed by the cap. */
  first: number;
  runs?: number[];
}

export function commandLine(command: string): string {
  return command.split(/\r?\n/, 1)[0].slice(0, 200);
}
