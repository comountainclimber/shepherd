import { useEffect, useState } from "react";
import { isFullyVerified } from "../../model/verify";
import { useShepherd } from "../../store";
import { Button, StatusDot, Tabs } from "../ui";
import { Actions } from "./Actions";
import { Execution } from "./Execution";
import { Overview } from "./Overview";
import { Verification } from "./Verification";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "execution", label: "Execution" },
  { id: "verification", label: "Verification" },
  { id: "actions", label: "Actions" },
];

export function TaskInspector() {
  const taskId = useShepherd((store) => store.ui.selectedTaskId);
  const task = useShepherd((store) => store.state.tasks.find((item) => item.id === taskId));
  const [tab, setTab] = useState("overview");
  const setInspectorOpen = useShepherd((store) => store.setInspectorOpen);

  useEffect(() => setTab("overview"), [taskId]);
  if (!task) return null;
  const verified = isFullyVerified(task);

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-line bg-surface">
      <header className="flex items-start gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot status={task.status} labeled />
            {task.status === "completed" && !verified ? (
              <span className="text-[10px] uppercase tracking-[0.08em] text-running">Needs your review</span>
            ) : null}
            {verified ? <span className="text-[10px] uppercase tracking-[0.08em] text-completed">Verified</span> : null}
          </div>
          <h2 className="mt-1 text-[14px] font-medium leading-snug text-text">{task.name}</h2>
        </div>
        <Button variant="quiet" onClick={() => setInspectorOpen(false)} aria-label="Close inspector">
          Close
        </Button>
      </header>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {tab === "overview" ? <Overview /> : null}
        {tab === "execution" ? <Execution /> : null}
        {tab === "verification" ? <Verification /> : null}
        {tab === "actions" ? <Actions /> : null}
      </div>
    </aside>
  );
}
