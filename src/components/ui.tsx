import {
  Bot,
  CircleCheck,
  CircleQuestionMark,
  CircleX,
  Clock,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  ScanSearch,
  Sparkles,
  User,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "../model/format";
import { STAGE_LABEL, type AssigneeKind, type Stage } from "../model/stage";
import type { Gate, TaskStatus, VerificationCheck, VerificationState } from "../model/types";
import { GATE_LABEL, STATUS_LABEL } from "../model/types";

export const statusBg: Record<TaskStatus, string> = {
  queued: "bg-queued",
  running: "bg-running",
  completed: "bg-completed",
  blocked: "bg-blocked",
  failed: "bg-failed",
};

export const statusText: Record<TaskStatus, string> = {
  queued: "text-queued",
  running: "text-running",
  completed: "text-completed",
  blocked: "text-blocked",
  failed: "text-failed",
};

export const checkBg: Record<VerificationState, string> = {
  passed: "bg-completed",
  failed: "bg-failed",
  pending: "bg-white/20",
};

/** Tailwind needs whole class names, so each stage's classes are spelled out. */
export const stageText: Record<Stage, string> = {
  waiting: "text-queued",
  ready: "text-ready",
  running: "text-running",
  checking: "text-checking",
  updating: "text-checking",
  "needs-you": "text-approval",
  verified: "text-completed",
  failed: "text-failed",
  paused: "text-blocked",
};

export const stageBg: Record<Stage, string> = {
  waiting: "bg-queued",
  ready: "bg-ready",
  running: "bg-running",
  checking: "bg-checking",
  updating: "bg-checking",
  "needs-you": "bg-approval",
  verified: "bg-completed",
  failed: "bg-failed",
  paused: "bg-blocked",
};

export const stageBorder: Record<Stage, string> = {
  waiting: "border-line-strong",
  ready: "border-ready/60",
  running: "border-running",
  checking: "border-checking/70",
  updating: "border-checking/70",
  "needs-you": "border-approval",
  verified: "border-completed/70",
  failed: "border-failed",
  paused: "border-blocked/70",
};

export const stageIcon: Record<Stage, LucideIcon> = {
  waiting: Clock,
  ready: Play,
  running: LoaderCircle,
  checking: ScanSearch,
  updating: RefreshCw,
  "needs-you": UserRound,
  verified: CircleCheck,
  failed: CircleX,
  paused: Pause,
};

export function StageBadge({ stage, size = "sm" }: { stage: Stage; size?: "sm" | "lg" }) {
  const Icon = stageIcon[stage];
  const spin = stage === "running" || stage === "updating";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md font-medium",
        size === "lg" ? "px-2 py-0.5 text-[12px]" : "px-1.5 py-px text-[11px]",
        stageText[stage],
      )}
      style={{ backgroundColor: "color-mix(in srgb, currentColor 14%, transparent)" }}
    >
      <Icon size={size === "lg" ? 13 : 11} className={cx(spin && "animate-spin")} strokeWidth={2.25} />
      {STAGE_LABEL[stage]}
    </span>
  );
}

const AVATAR: Record<AssigneeKind, { icon: LucideIcon; className: string }> = {
  codex: { icon: Bot, className: "bg-emerald-400/15 text-emerald-300" },
  claude: { icon: Sparkles, className: "bg-orange-400/15 text-orange-300" },
  person: { icon: User, className: "bg-violet-400/15 text-violet-300" },
  none: { icon: CircleQuestionMark, className: "bg-white/5 text-faint" },
};

export function Avatar({ kind, size = 28, className }: { kind: AssigneeKind; size?: number; className?: string }) {
  const { icon: Icon, className: tone } = AVATAR[kind];
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center rounded-lg", tone, className)} style={{ width: size, height: size }}>
      <Icon size={Math.round(size * 0.55)} strokeWidth={2} />
    </span>
  );
}

/** One dot per check: green when it passed, red when it failed, hollow while it waits. */
export function CheckDots({ checks }: { checks: VerificationCheck[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {checks.map((check) => (
        <span
          key={check.id}
          title={`${check.kind === "review" ? "Your review" : "Check"}: ${check.running ? "running" : check.state}`}
          className={cx(
            "inline-block h-2 w-2 rounded-full",
            check.running
              ? "animate-pulse bg-checking"
              : check.state === "passed"
                ? "bg-completed"
                : check.state === "failed"
                  ? "bg-failed"
                  : "border border-white/30",
          )}
        />
      ))}
    </span>
  );
}

export function ProgressBar({ percent, className, tone = "bg-completed" }: { percent: number; className?: string; tone?: string }) {
  return (
    <div className={cx("h-1.5 overflow-hidden rounded-full bg-white/10", className)}>
      <div className={cx("h-full rounded-full transition-[width] duration-500", tone)} style={{ width: `${percent}%` }} />
    </div>
  );
}

const BUTTON_TONE = {
  primary: "bg-brass text-ink hover:bg-brass-2",
  go: "bg-completed text-emerald-950 hover:brightness-110",
  danger: "bg-failed text-rose-950 hover:brightness-110",
  ghost: "border border-line-strong bg-surface-2 text-text hover:bg-surface-3",
  quiet: "text-muted hover:bg-surface-2 hover:text-text",
};

export function Button({
  variant = "ghost",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_TONE; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      type={type}
      {...props}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium transition-[background-color,filter] disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" && "h-7 px-2.5 text-[12px]",
        size === "md" && "h-8 px-3 text-[13px]",
        size === "lg" && "h-10 px-4 text-[14px]",
        BUTTON_TONE[variant],
        className,
      )}
    />
  );
}

export function Dialog({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 px-6 pt-[10vh]" onMouseDown={onClose}>
      <div
        className={cx("enter w-full overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-text">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[13px] leading-5 text-muted">{subtitle}</p> : null}
          </div>
          <button type="button" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="max-h-[62vh] overflow-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string; alert?: boolean }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-4 border-b border-line">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cx(
            "relative -mb-px border-b-2 pb-2 pt-1 text-[13px] font-medium transition-colors",
            value === tab.id ? "border-brass text-text" : "border-transparent text-muted hover:text-text",
          )}
        >
          {tab.label}
          {tab.alert ? <span className="absolute -right-2 top-1 h-1.5 w-1.5 rounded-full bg-approval" /> : null}
        </button>
      ))}
    </div>
  );
}

export function StatusDot({ status, labeled = false }: { status: TaskStatus; labeled?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5", statusText[status])}>
      <span className={cx("h-2 w-2 rounded-full", statusBg[status], status === "running" && "animate-pulse")} />
      {labeled ? <span className="text-[12px]">{STATUS_LABEL[status]}</span> : null}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

const controlClass =
  "w-full rounded-lg border border-line-strong bg-black/20 px-3 text-[13px] text-text outline-none placeholder:text-faint focus:border-brass";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(controlClass, "h-8", props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(controlClass, "min-h-20 py-2 leading-5", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(controlClass, "h-8", props.className)} />;
}

export function GateSelect({ value, onChange }: { value: Gate; onChange: (gate: Gate) => void }) {
  return (
    <select
      aria-label="Gate"
      value={value}
      onChange={(event) => onChange(event.target.value as Gate)}
      className="h-7 w-[7.5rem] shrink-0 rounded-md border border-line-strong bg-black/20 px-1 text-[12px] text-muted outline-none focus:border-brass"
    >
      {(Object.keys(GATE_LABEL) as Gate[]).map((gate) => (
        <option key={gate} value={gate}>
          {GATE_LABEL[gate]}
        </option>
      ))}
    </select>
  );
}

export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-faint">{label}</div>
      <div className="truncate font-mono text-[12px] text-text" title={value}>
        {value}
      </div>
    </div>
  );
}

/** A panel section with a small heading. */
export function Card({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-line bg-surface-2/50 p-3", className)}>
      {title ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[12px] font-medium text-muted">{title}</h3>
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}
