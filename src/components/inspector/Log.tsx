import { MessageSquare, Send } from "lucide-react";
import { useState } from "react";
import { formatClock, formatDuration } from "../../model/format";
import { instructTask, workspacePath } from "../../runner/live";
import { useShepherd } from "../../store";
import { Button, Card, Meta, TextArea } from "../ui";
import { useSelectedTask } from "./useSelectedTask";

export function Log() {
  const task = useSelectedTask();
  const project = useShepherd((store) => store.state.projects.find((item) => item.id === task.projectId));
  const allEvents = useShepherd((store) => store.state.events);
  const events = allEvents.filter((event) => event.taskId === task.id).slice(-14).reverse();
  const [note, setNote] = useState("");
  const human = task.runner === "human";
  const git = task.git;
  const folder = git?.folder ?? project?.repo ?? [workspacePath() || ".agent-sandbox", project?.directory].filter(Boolean).join("/");

  return (
    <div className="space-y-3">
      {human ? null : (
        <Card title="Tell the agent">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!note.trim()) return;
              void instructTask(task.id, note);
              setNote("");
            }}
          >
            <TextArea
              rows={2}
              value={note}
              placeholder="Use vitest 5. Keep the button blue."
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit();
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[11px] leading-4 text-faint">
                {task.sessionId && task.status !== "running" ? "Sending picks up its last session with this." : "Saved for its next run."}
              </p>
              <Button variant="primary" size="sm" type="submit" disabled={!note.trim()}>
                <Send size={13} /> Send
              </Button>
            </div>
          </form>
          {task.instructions.length ? (
            <ul className="mt-3 space-y-1">
              {task.instructions.map((line, index) => (
                <li key={`${task.id}-note-${index}`} className="flex gap-2 rounded-lg bg-black/25 px-2.5 py-1.5 text-[12px] leading-5 text-text">
                  <MessageSquare size={13} className="mt-0.5 shrink-0 text-ready" />
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      )}
      <Card title="What happened">
        {task.activity ? <p className="mb-2 text-[13px] leading-5 text-text">{task.activity}</p> : null}
        <ol className="space-y-1.5">
          {events.map((event) => (
            <li key={event.id} className="flex gap-2.5 text-[12px] leading-5 text-muted">
              <span className="shrink-0 font-mono text-[10px] leading-5 text-faint">{formatClock(event.at)}</span>
              <span>{event.message}</span>
            </li>
          ))}
          {!events.length ? <li className="text-[12px] text-faint">Nothing yet.</li> : null}
        </ol>
      </Card>
      <Card title="Details">
        <div className="grid grid-cols-2 gap-3">
          {human ? null : (
            <>
              <Meta label="Branch" value={git ? git.branch : "Made on the first run"} />
              <Meta label="Commit" value={git?.head ?? "—"} />
              <Meta label="Session" value={task.sessionId ? task.sessionId.slice(0, 12) : "—"} />
            </>
          )}
          <Meta label="Started" value={formatClock(task.startedAt)} />
          <Meta label="Last run took" value={task.elapsedMs ? formatDuration(task.elapsedMs) : "—"} />
        </div>
        <div className="mt-3 text-[11px] font-medium text-faint">{git ? "Worktree" : "Project folder"}</div>
        <div className="break-all font-mono text-[11px] leading-5 text-text">{folder}/</div>
      </Card>
    </div>
  );
}
