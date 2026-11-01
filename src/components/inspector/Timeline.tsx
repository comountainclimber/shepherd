import { useEffect, useRef, useState } from "react";
import type { Task } from "../../model/types";
import type { TimelineEntry, TimelinePage } from "../../runner/timeline";
import { mergeTimeline, quietTime, timelineRows } from "../../runner/timelineView";
import { lookUrl } from "../../runner/live";
import { Card } from "../ui";

export function Timeline({ task }: { task: Task }) {
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const cursor = useRef(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/tasks/${encodeURIComponent(task.id)}/timeline?after=${cursor.current}`, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Timeline unavailable");
        const page = await response.json() as TimelinePage;
        if (abort.signal.aborted) return;
        cursor.current = page.cursor;
        setEntries((previous) => mergeTimeline(previous ?? [], page));
        setError(false);
      }).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [task, retry]);
  useEffect(() => {
    if (task.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [task.status]);

  if (!entries?.length) return <p className="text-[12px] text-muted" role="status">
    {error ? <>Could not load the timeline. <button className="underline" onClick={() => setRetry((value) => value + 1)}>Try again</button></>
      : entries === null ? "Loading timeline…" : task.output || task.status === "completed" || task.status === "failed" ? "This step has no timeline." : "The timeline starts when this step runs."}
  </p>;
  return <Card title="Timeline">
    {error ? <p className="mb-2 text-[12px] text-approval">Could not load new entries. <button className="underline" onClick={() => setRetry((value) => value + 1)}>Try again</button></p> : null}
    <TimelineRuns entries={entries} task={task} now={now} />
  </Card>;
}

export function TimelineRuns({ entries, task, now }: { entries: TimelineEntry[]; task: Task; now: number }) {
  const runs = new Map<number, TimelineEntry[]>();
  for (const entry of entries) {
    const run = runs.get(entry.run) ?? [];
    run.push(entry);
    runs.set(entry.run, run);
  }
  const ordered = [...runs.entries()];
  return (
    <div className="space-y-2">
      {[...ordered].reverse().map(([id, run], index) => {
        const start = run[0];
        const end = [...run].reverse().find((entry) => entry.kind === "run_ended");
        const outcomes = new Map(run.flatMap((entry) => entry.kind === "command_end" ? [[entry.commandId, entry] as const] : []));
        const previous = ordered[ordered.findIndex(([key]) => key === id) - 1]?.[1].at(-1);
        return <details key={`${id}-${index === 0}`} open={index === 0} className="rounded-lg border border-line bg-black/15" data-timeline-run>
          <summary className="cursor-pointer px-2.5 py-2 text-[12px] text-text">
            <span className="font-medium">{start.kind === "run_started" ? start.text : "Run"}</span>
            <span className="ml-2 text-faint">{new Date(start.at).toLocaleDateString([], { month: "short", day: "numeric" })} · <Time at={start.at} /></span>
            {end?.kind === "run_ended" ? <span className={`ml-2 ${end.outcome === "failed" ? "text-failed" : "text-muted"}`}>{end.outcome === "completed" ? "Finished" : end.outcome === "failed" ? "Failed" : "Stopped"}</span> : null}
          </summary>
          <div className="space-y-3 border-t border-line px-2.5 py-3 text-[12px] leading-5 [overflow-wrap:anywhere]">
            {previous && start.at - previous.at > 600_000 ? <Gap from={previous.at} to={start.at} /> : null}
            {timelineRows(run, index === 0 && task.status === "running" ? now : undefined).map((row, position) => {
              if (row.kind === "gap") return <Gap key={`gap-${position}`} from={row.from} to={row.to} />;
              if (row.kind === "commands") return <details key={row.entries[0].id} data-timeline-commands>
                <summary className="cursor-pointer text-muted"><Time at={row.entries[0].at} /> <span className="ml-2 text-text">Ran {row.entries.length} {row.entries.length === 1 ? "command" : "commands"}</span></summary>
                <ul className="mt-2 space-y-2 border-l border-line pl-3">
                  {row.entries.map((command) => {
                    if (command.kind !== "command") return null;
                    const outcome = outcomes.get(command.commandId);
                    return <li key={command.id}><div className="text-faint"><Time at={command.at} />{outcome && "text" in outcome ? <> · {outcome.text} at <Time at={outcome.at} /></> : " · No outcome reported"}</div><code className="whitespace-pre-wrap break-all text-text">{command.text}</code></li>;
                  })}
                </ul>
              </details>;
              return <Entry key={row.entry.id} entry={row.entry} taskId={task.id} />;
            })}
          </div>
        </details>;
      })}
    </div>
  );
}

function Time({ at }: { at: number }) {
  return <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString()} className="text-[10px] text-faint">{new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>;
}

function Gap({ from, to }: { from: number; to: number }) {
  return <p className="border-y border-dashed border-line py-2 text-[11px] text-faint" title={`${new Date(from).toLocaleString()} to ${new Date(to).toLocaleString()}`}>{quietTime(from, to)}</p>;
}

function Entry({ entry, taskId }: { entry: TimelineEntry; taskId: string }) {
  if (entry.kind === "command" || entry.kind === "command_end") return null;
  const time = <Time at={entry.at} />;
  if (entry.kind === "acceptance") return <div>{time}<p className="text-muted">Agent says: {entry.met ? "met" : "took back"} Done when {entry.item}</p><p className="text-text">{entry.text}</p>{entry.note ? <p className="whitespace-pre-wrap text-muted">{entry.note}</p> : null}</div>;
  if (entry.kind === "screenshot") return <div>{time}<a href={lookUrl(taskId, entry.look.file)} target="_blank" rel="noreferrer" className="mt-1 block w-36 max-w-full overflow-hidden rounded border border-line hover:border-line-strong"><img src={lookUrl(taskId, entry.look.file)} alt={`${entry.look.url} at ${entry.look.width}px`} loading="lazy" className="aspect-[4/3] w-full object-cover object-top" /></a><p className="mt-1 text-[11px] text-muted">Screenshot · {entry.look.width}px{entry.look.errors.length ? ` · ${entry.look.errors.length} page errors` : ""}</p></div>;
  if (entry.kind === "files") return <details><summary className="cursor-pointer text-muted">{time} <span className="ml-2">Changed {entry.files.length} {entry.files.length === 1 ? "file" : "files"}</span></summary><ul className="mt-1 font-mono text-[11px] text-text">{entry.files.map((file, index) => <li key={index}>{file}</li>)}</ul></details>;
  if (entry.kind === "report") return <details><summary className="cursor-pointer text-muted">{time} <span className="ml-2 text-text">Final report</span></summary><p className="mt-1 whitespace-pre-wrap text-text">{entry.text}</p></details>;
  if (entry.kind === "check_ended" && entry.detail) return <details><summary className={`cursor-pointer ${entry.ok ? "text-completed" : "text-failed"}`}>{time} <span className="ml-2">{entry.text}</span></summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-muted">{entry.detail}</pre></details>;
  const failed = entry.kind === "check_ended" && !entry.ok || entry.kind === "run_ended" && entry.outcome === "failed";
  return <div>{time}<p className={`whitespace-pre-wrap ${failed ? "text-failed" : entry.kind === "note" ? "text-text" : "text-muted"}`}>{entry.kind === "check_started" ? `Checking: ${entry.text}` : entry.text}</p></div>;
}
