import { X } from "lucide-react";
import {
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "../model/format";
import type { Gate, TaskStatus, VerificationState } from "../model/types";
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

export function Button({
  variant = "ghost",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "quiet" | "danger" }) {
  return (
    <button
      type={type}
      {...props}
      className={cx(
        "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" && "bg-brass font-medium text-ink hover:bg-brass-2",
        variant === "ghost" && "border border-line bg-transparent text-text hover:bg-surface-2",
        variant === "quiet" && "text-muted hover:bg-surface-2 hover:text-text",
        variant === "danger" && "border border-failed/30 text-failed hover:bg-failed/10",
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
        className={cx("w-full border border-line bg-surface", wide ? "max-w-3xl" : "max-w-lg")}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-3 py-2.5">
          <div>
            <h2 className="text-[13px] font-medium text-text">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[12px] leading-5 text-muted">{subtitle}</p> : null}
          </div>
          <button type="button" className="text-muted hover:text-text" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </header>
        <div className="max-h-[62vh] overflow-auto px-3 py-3">{children}</div>
        {footer ? <footer className="flex items-center justify-end gap-2 border-t border-line px-3 py-2">{footer}</footer> : null}
      </div>
    </div>
  );
}

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-3 border-b border-line px-3">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cx(
            "-mb-px border-b py-2 text-[12px]",
            value === tab.id ? "border-brass text-text" : "border-transparent text-muted hover:text-text",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function StatusDot({ status, labeled = false }: { status: TaskStatus; labeled?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5", statusText[status])}>
      <span className={cx("h-1.5 w-1.5 rounded-full", statusBg[status], status === "running" && "rail-live")} />
      {labeled ? <span className="text-[11px]">{STATUS_LABEL[status]}</span> : null}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      {children}
    </label>
  );
}

const controlClass =
  "w-full rounded-md border border-line bg-surface-2 px-2 text-[12px] text-text outline-none placeholder:text-faint focus:border-brass";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(controlClass, "h-8", props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(controlClass, "min-h-20 py-1.5 leading-5", props.className)} />;
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
      className="h-6 w-[7.5rem] shrink-0 rounded-md border border-line bg-surface-2 px-1 text-[11px] text-muted outline-none focus:border-brass"
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
      <div className="text-[10px] uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className="truncate font-mono text-[12px] text-text">{value}</div>
    </div>
  );
}
