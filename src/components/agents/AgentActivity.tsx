import { useEffect, useState } from "react";
import { cx } from "../../model/format";
import { assigneeFor, stageHint, stageOf, type AssigneeKind, type Stage } from "../../model/stage";
import { tasksForGoal } from "../../model/selectors";
import { pathFor } from "../../model/route";
import type { Task } from "../../model/types";
import { EFFORT_LABEL, modelName, type ModelCatalog } from "../../model/models";
import { isFullyVerified } from "../../model/verify";
import { agentStatus } from "../../runner/live";
import { useShepherd } from "../../store";
import { Avatar, ProgressBar, StageBadge, stageText } from "../ui";
import { useModels } from "../useModels";

const ORDER: Record<Stage, number> = {
  running: 0,
  checking: 1,
  updating: 2,
  "needs-you": 3,
  failed: 4,
  paused: 5,
  ready: 6,
  waiting: 7,
  verified: 8,
};

/** "your default, GPT-6.1-Sol at High", or just "your default" when the agent's settings do not say. */
function defaults(catalog: ModelCatalog | null, provider: "codex" | "claude"): string {
  const own = catalog?.[provider].default;
  if (!own?.model) return "your default model";
  const effort = own.effort ? ` at ${EFFORT_LABEL[own.effort]}` : "";
  const instead = own.unavailable ? `, since ${own.unavailable} is no longer offered` : "";
  return `your default, ${modelName(own.model, catalog, provider)}${effort}${instead}`;
}

/** Who can take steps, what each is doing in this task, and how much of it is done. */
export function AgentActivity() {
  const state = useShepherd((store) => store.state);
  const goalId = useShepherd((store) => store.ui.goalId);
  const [online, setOnline] = useState<{ claude: boolean; codex: boolean } | null>(null);
  const catalog = useModels();
  const tasks = tasksForGoal(state, goalId);
  const members: { kind: AssigneeKind; name: string; role: string }[] = [
    { kind: "codex", name: "Codex", role: `OpenAI · ${defaults(catalog, "codex")}` },
    { kind: "claude", name: "Claude Code", role: `Anthropic · ${defaults(catalog, "claude")}` },
    { kind: "person", name: "You", role: "Reviews, sign-offs, and anything only a person can do" },
  ];

  useEffect(() => {
    agentStatus()
      .then((status) => setOnline({ claude: status.claude, codex: status.codex }))
      .catch(() => setOnline({ claude: false, codex: false }));
  }, []);

  return (
    <div className="h-full overflow-auto bg-bg px-6 py-6">
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-3">
        {members.map((member) => (
          <AgentCard
            key={member.kind}
            {...member}
            online={member.kind === "person" ? true : online ? online[member.kind === "codex" ? "codex" : "claude"] : null}
            tasks={tasks.filter((task) => assigneeFor(task).kind === member.kind)}
          />
        ))}
      </div>
      <p className="mx-auto mt-5 max-w-6xl text-center text-[12px] text-faint">
        Every run is its own Claude Code or Codex process on its own branch, so one agent can work on several steps at once.
      </p>
    </div>
  );
}

function AgentCard({ kind, name, role, online, tasks }: { kind: AssigneeKind; name: string; role: string; online: boolean | null; tasks: Task[] }) {
  const state = useShepherd((store) => store.state);
  const selectTask = useShepherd((store) => store.selectTask);
  const staged = tasks
    .map((task) => ({ task, stage: stageOf(task, state.tasks, state.dependencies) }))
    .sort((a, b) => ORDER[a.stage] - ORDER[b.stage]);
  const running = staged.filter((item) => item.stage === "running" || item.stage === "checking" || item.stage === "updating").length;
  const done = tasks.filter(isFullyVerified).length;
  const failed = staged.filter((item) => item.stage === "failed").length;

  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Avatar kind={kind} size={40} className={cx(online === false && "opacity-50")} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-tight text-text">{name}</h2>
          <div className="truncate text-[12px] text-muted" title={role}>
            {role}
          </div>
        </div>
        {kind !== "person" ? (
          <span
            className={cx(
              "inline-flex items-center gap-1.5 rounded-md px-1.5 py-px text-[11px] font-medium",
              online == null ? "bg-white/5 text-faint" : online ? "bg-completed/15 text-completed" : "bg-failed/15 text-failed",
            )}
          >
            <span className={cx("h-1.5 w-1.5 rounded-full", online == null ? "bg-faint" : online ? "bg-completed" : "bg-failed")} />
            {online == null ? "Checking…" : online ? "Ready" : "Signed out"}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-3 gap-2 px-4 pt-3">
        <Stat value={running} label="running" tone="text-running" />
        <Stat value={done} label="done" tone="text-completed" />
        <Stat value={failed} label="failed" tone="text-failed" />
      </div>
      <div className="px-4 pt-3">
        <ProgressBar percent={tasks.length ? (done / tasks.length) * 100 : 0} />
        <div className="mt-1 text-right text-[11px] text-faint">
          {tasks.length ? `${done} of ${tasks.length} ${tasks.length === 1 ? "step" : "steps"} in this task done` : "No steps in this task"}
        </div>
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 px-2 pb-3 pt-2">
        {staged.map(({ task, stage }) => (
          <li key={task.id}>
            <a
              href={pathFor({ goalId: task.goalId, view: "canvas", stepId: task.id, tab: "step" })}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                selectTask(task.id);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-text">{task.name}</span>
                <span className={cx("block truncate text-[11px]", stage === "failed" ? stageText.failed : "text-faint")}>
                  {stageHint(task, stage, state.tasks, state.dependencies)}
                </span>
              </span>
              <StageBadge stage={stage} />
            </a>
          </li>
        ))}
        {online === false && kind !== "person" ? (
          <li className="px-2 pt-1 text-[12px] leading-5 text-failed">
            Run {kind === "codex" ? "codex login" : "claude login"} in a terminal before it can take tasks.
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="rounded-lg bg-black/20 px-3 py-2 text-center">
      <div className={cx("font-mono text-[18px] leading-none", value ? tone : "text-faint")}>{value}</div>
      <div className="mt-1 text-[11px] text-muted">{label}</div>
    </div>
  );
}
