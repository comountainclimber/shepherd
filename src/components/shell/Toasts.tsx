import { Bookmark, CircleCheck, CircleX, UserRound, X } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";
import { cx } from "../../model/format";
import { firstLine, progress, stageOf, type Stage } from "../../model/stage";
import { useShepherd } from "../../store";

type Tone = "verified" | "failed" | "needs-you" | "saved";

interface Toast {
  id: number;
  tone: Tone;
  title: string;
  detail: string;
  taskId?: string;
}

interface ToastStore {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

const TOAST_MS = 6000;
let nextToast = 1;

const useToasts = create<ToastStore>()((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = nextToast++;
    set((store) => ({ toasts: [...store.toasts, { ...toast, id }].slice(-4) }));
    window.setTimeout(() => get().dismiss(id), TOAST_MS);
  },
  dismiss: (id) => set((store) => ({ toasts: store.toasts.filter((toast) => toast.id !== id) })),
}));

/** Says that something you did worked, such as saving a step for reuse. */
export function notify(title: string, detail = "") {
  useToasts.getState().push({ tone: "saved", title, detail });
}

/**
 * Tells you when a step is done, fails, or starts waiting on you, and when a whole plan finishes.
 * The first board a tab receives is the baseline, so loading the page is quiet.
 */
export function useTaskToasts() {
  useEffect(() => {
    let seen: Map<string, Stage> | null = null;
    let finished: Map<string, boolean> | null = null;
    const watch = (store: ReturnType<typeof useShepherd.getState>) => {
      if (!store.loaded) return;
      const { tasks, dependencies, goals } = store.state;
      const now = new Map(tasks.map((task) => [task.id, stageOf(task, tasks, dependencies)]));
      const complete = new Map(goals.map((project) => [project.id, progress(tasks.filter((task) => task.goalId === project.id)).complete]));
      if (seen && finished) {
        const { push } = useToasts.getState();
        for (const task of tasks) {
          const before = seen.get(task.id);
          const after = now.get(task.id)!;
          if (!before || before === after) continue;
          const name = task.name || "A step";
          if (after === "verified") {
            const detail = task.verification.length ? "Its checks passed." : firstLine(task.output) || "It finished.";
            push({ tone: "verified", title: `${name} is done`, detail, taskId: task.id });
          } else if (after === "failed") push({ tone: "failed", title: `${name} failed`, detail: task.blocker ?? "Open it to see why.", taskId: task.id });
          else if (after === "needs-you") push({ tone: "needs-you", title: `${name} needs you`, detail: "Open it to review or finish it.", taskId: task.id });
        }
        for (const project of goals) {
          if (!complete.get(project.id) || finished.get(project.id) !== false) continue;
          const last = tasks.filter((task) => task.goalId === project.id).at(-1);
          if (last) push({ tone: "verified", title: `Every step in ${project.name} is done`, detail: "Merge the result from Task actions in the header.", taskId: last.id });
        }
      }
      seen = now;
      finished = complete;
    };
    watch(useShepherd.getState());
    return useShepherd.subscribe(watch);
  }, []);
}

const TONE: Record<Tone, { icon: typeof CircleCheck; className: string }> = {
  verified: { icon: CircleCheck, className: "text-completed" },
  failed: { icon: CircleX, className: "text-failed" },
  "needs-you": { icon: UserRound, className: "text-approval" },
  saved: { icon: Bookmark, className: "text-brass" },
};

export function Toasts() {
  const toasts = useToasts((store) => store.toasts);
  const dismiss = useToasts((store) => store.dismiss);
  const selectTask = useShepherd((store) => store.selectTask);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-96 -translate-x-1/2 flex-col gap-2">
      {toasts.map((toast) => {
        const { icon: Icon, className } = TONE[toast.tone];
        return (
          <div
            key={toast.id}
            className="enter pointer-events-auto flex items-start gap-3 rounded-lg border border-line-strong bg-surface-2 px-3 py-2.5 shadow-xl"
          >
            <Icon size={18} className={cx("mt-0.5 shrink-0", className)} />
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                if (toast.taskId) selectTask(toast.taskId);
                dismiss(toast.id);
              }}
            >
              <div className="truncate text-[13px] font-medium text-text">{toast.title}</div>
              {toast.detail ? <div className="line-clamp-2 text-[12px] text-muted">{toast.detail}</div> : null}
            </button>
            <button type="button" aria-label="Dismiss" className="text-faint hover:text-text" onClick={() => dismiss(toast.id)}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
