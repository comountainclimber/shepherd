import { useState } from "react";
import { cx, formatClock } from "../../model/format";
import { useShepherd } from "../../store";

export function ActivityStrip() {
  const projectId = useShepherd((store) => store.ui.projectId);
  const allEvents = useShepherd((store) => store.state.events);
  const allNotifications = useShepherd((store) => store.state.notifications);
  const allTasks = useShepherd((store) => store.state.tasks);
  const events = allEvents.filter((event) => event.projectId === projectId);
  const tasks = allTasks.filter((task) => task.projectId === projectId);
  const notifications = allNotifications.filter(
    (item) => !item.taskId || tasks.some((task) => task.id === item.taskId),
  );
  const selectTask = useShepherd((store) => store.selectTask);
  const dispatch = useShepherd((store) => store.dispatch);
  const [open, setOpen] = useState(false);
  const running = tasks.filter((task) => task.status === "running").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const latest = [...events].slice(-4).reverse();
  const unread = notifications.filter((item) => !item.read);

  return (
    <div className="relative shrink-0 border-t border-line bg-bg">
      {open ? (
        <div className="absolute bottom-full left-0 right-0 z-20 max-h-56 overflow-auto border-t border-line bg-surface">
          <div className="grid gap-4 px-3 py-2 md:grid-cols-2">
            <section>
              <h3 className="mb-1 text-[10px] uppercase tracking-[0.12em] text-faint">Events</h3>
              <ul>
                {[...events].slice(-12).reverse().map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      className="flex w-full gap-2 py-1 text-left text-[12px] hover:text-brass"
                      onClick={() => selectTask(event.taskId)}
                    >
                      <span className="font-mono text-[10px] text-faint">{formatClock(event.at)}</span>
                      <span className={tone(event.tone)}>{event.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-1 text-[10px] uppercase tracking-[0.12em] text-faint">Notifications</h3>
              <ul>
                {[...notifications].slice(-8).reverse().map((item) => (
                  <li key={item.id} className="flex items-start gap-2 py-1">
                    <button
                      type="button"
                      className={cx("min-w-0 flex-1 text-left text-[12px]", tone(item.tone))}
                      onClick={() => item.taskId && selectTask(item.taskId)}
                    >
                      {item.message}
                    </button>
                    <button
                      type="button"
                      className="text-[11px] text-faint hover:text-text"
                      onClick={() => dispatch({ type: "dismissNotification", id: item.id })}
                    >
                      Dismiss
                    </button>
                  </li>
                ))}
                {!notifications.length ? <li className="text-[12px] text-faint">None.</li> : null}
              </ul>
            </section>
          </div>
        </div>
      ) : null}
      <div className="flex h-9 items-center gap-3 px-3">
        <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-muted">
          <span className={running ? "text-running" : ""}>{running} running</span>
          <span className={failed ? "text-failed" : ""}>{failed} failed</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
          {latest.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => selectTask(event.taskId)}
              className="truncate text-[12px] text-muted hover:text-text"
            >
              <span className="mr-1 font-mono text-[10px] text-faint">{formatClock(event.at)}</span>
              {event.message}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="shrink-0 text-[12px] text-muted hover:text-text"
          onClick={() => {
            if (!open) dispatch({ type: "readNotifications" });
            setOpen(!open);
          }}
        >
          {open ? "Hide" : unread.length ? `${unread.length} new` : "Activity"}
        </button>
      </div>
    </div>
  );
}

function tone(value: "info" | "success" | "warning" | "failure") {
  if (value === "success") return "text-completed";
  if (value === "failure") return "text-failed";
  if (value === "warning") return "text-running";
  return "text-muted";
}
