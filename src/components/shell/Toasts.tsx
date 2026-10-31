import { CircleCheck, CircleX, UserRound, X } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";
import { cx } from "../../model/format";
import { stageOf, type Stage } from "../../model/stage";
import { useShepherd } from "../../store";

type Tone = "verified" | "failed" | "needs-you";

interface Toast {
  id: number;
  tone: Tone;
  title: string;
  detail: string;
  taskId: string;
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

/**
 * Tells you when a task is verified, fails, or starts waiting on you. The first board a tab
 * receives is the baseline, so loading the page is quiet.
 */
export function useTaskToasts() {
  useEffect(() => {
    let seen: Map<string, Stage> | null = null;
    const watch = (store: ReturnType<typeof useShepherd.getState>) => {
      if (!store.loaded) return;
      const { tasks, dependencies } = store.state;
      const now = new Map(tasks.map((task) => [task.id, stageOf(task, tasks, dependencies)]));
      if (seen) {
        const { push } = useToasts.getState();
        for (const task of tasks) {
          const before = seen.get(task.id);
          const after = now.get(task.id)!;
          if (!before || before === after) continue;
          if (after === "verified") push({ tone: "verified", title: `${task.name} is verified`, detail: "All its checks passed.", taskId: task.id });
          else if (after === "failed") push({ tone: "failed", title: `${task.name} failed`, detail: task.blocker ?? "Open it to see why.", taskId: task.id });
          else if (after === "needs-you") push({ tone: "needs-you", title: `${task.name} needs you`, detail: "Open it to review or finish it.", taskId: task.id });
        }
      }
      seen = now;
    };
    watch(useShepherd.getState());
    return useShepherd.subscribe(watch);
  }, []);
}

const TONE: Record<Tone, { icon: typeof CircleCheck; className: string }> = {
  verified: { icon: CircleCheck, className: "text-completed" },
  failed: { icon: CircleX, className: "text-failed" },
  "needs-you": { icon: UserRound, className: "text-approval" },
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
                selectTask(toast.taskId);
                dismiss(toast.id);
              }}
            >
              <div className="truncate text-[13px] font-medium text-text">{toast.title}</div>
              <div className="line-clamp-2 text-[12px] text-muted">{toast.detail}</div>
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
