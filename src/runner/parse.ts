import { commandLine, type TimelineEvent } from "./timeline";

export interface ParsedAgentLine {
  activity?: string;
  chatId?: string;
  done?: boolean;
  ok?: boolean;
  summary?: string;
  /** The whole of something the agent said, untrimmed. The last one is its report. */
  message?: string;
}

export function parseAgentLine(line: string): ParsedAgentLine | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const chatId = stringField(data, ["session_id", "sessionId", "chatId", "chat_id", "thread_id"]);
  const type = typeof data.type === "string" ? data.type : "";
  if (type === "thread.started") return { chatId };
  if (type === "turn.completed") return { chatId, done: true, ok: true, summary: "Codex finished" };
  if (type === "error" || type === "turn.failed") {
    const error = data.error as { message?: string } | undefined;
    return { chatId, done: true, ok: false, summary: stringField(data, ["message", "error"]) || error?.message || "Agent failed" };
  }
  const said = codexMessage(data);
  if (said) return { chatId, activity: said.replace(/\s+/g, " ").slice(0, 240), message: said };
  const itemActivity = codexItem(data);
  if (itemActivity) return { chatId, activity: itemActivity };
  if (type === "result" || type === "done") {
    const failed = data.is_error === true || data.subtype === "error" || data.status === "error";
    const result = stringField(data, ["result", "text", "message"]);
    const summary = result || (failed ? "Cursor agent failed" : "Cursor agent finished");
    return { chatId, done: true, ok: !failed, summary, ...(result ? { message: result } : {}) };
  }
  const tool = toolName(data);
  if (tool) return { chatId, activity: tool };
  const text = assistantText(data);
  if (text) return { chatId, activity: text.replace(/\s+/g, " ").slice(0, 240), message: text };
  if (chatId) return { chatId };
  return null;
}

/** Only observations from the stream: no command output, reasoning, or inferred outcomes. */
export function createTimelineParser() {
  const tools = new Map<string, { command?: boolean; file?: string }>();
  const commands = new Set<string>();
  return function parseTimelineLine(line: string): TimelineEvent[] {
    let data: Record<string, unknown> | undefined;
    try { data = record(JSON.parse(line)); } catch { return []; }
    if (!data) return [];
    const item = record(data.item);
    if (data.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string" && item.text.trim()) {
      return [{ kind: "note", text: item.text }];
    }
    if ((data.type === "item.started" || data.type === "item.completed") && item?.type === "command_execution" && typeof item.command === "string") {
      const commandId = String(item.id ?? commandLine(item.command));
      const events: TimelineEvent[] = [];
      if (!commands.has(commandId)) events.push({ kind: "command", commandId, text: commandLine(item.command) });
      if (data.type === "item.started") commands.add(commandId);
      if (data.type === "item.completed") {
        commands.delete(commandId);
        const text = typeof item.exit_code === "number" ? `Exited ${item.exit_code}` : typeof item.status === "string" ? item.status : "Ended";
        events.push({ kind: "command_end", commandId, text });
      }
      return events;
    }
    if (data.type === "item.completed" && item?.type === "file_change" && item.status !== "failed" && Array.isArray(item.changes)) {
      const files = item.changes.flatMap((change: unknown) => {
        const file = record(change)?.path;
        return typeof file === "string" ? [file] : [];
      });
      return files.length ? [{ kind: "files", files }] : [];
    }
    const content = record(data.message)?.content;
    if (data.type === "assistant" && typeof content === "string") return [{ kind: "note", text: content }];
    if (!Array.isArray(content)) return [];
    const blocks = content.flatMap((value: unknown) => { const block = record(value); return block ? [block] : []; });
    if (data.type === "assistant") return blocks.flatMap((block): TimelineEvent[] => {
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) return [{ kind: "note", text: block.text }];
      if (block.type !== "tool_use") return [];
      const input = record(block.input);
      if (block.name === "Bash" && typeof input?.command === "string") {
        tools.set(String(block.id), { command: true });
        return [{ kind: "command", commandId: String(block.id), text: commandLine(input.command) }];
      }
      if (["Write", "Edit", "MultiEdit"].includes(String(block.name)) && typeof input?.file_path === "string") {
        tools.set(String(block.id), { file: input.file_path });
      }
      return [];
    });
    if (data.type === "user") return blocks.flatMap((block): TimelineEvent[] => {
      if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") return [];
      const tool = tools.get(block.tool_use_id);
      tools.delete(block.tool_use_id);
      if (tool?.command) return [{ kind: "command_end", commandId: block.tool_use_id, text: block.is_error ? "Failed" : "Completed" }];
      if (tool?.file && !block.is_error) return [{ kind: "files", files: [tool.file] }];
      return [];
    });
    return [];
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function assistantText(data: Record<string, unknown>): string | undefined {
  const message = data.message;
  if (!message || typeof message !== "object") {
    return typeof data.text === "string" ? data.text : undefined;
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const record = block as { type?: string; text?: string };
      return record.type === "text" && record.text ? record.text : "";
    })
    .filter(Boolean);
  return parts.join(" ") || undefined;
}

function codexMessage(data: Record<string, unknown>): string | undefined {
  if (data.type !== "item.completed") return undefined;
  const item = data.item as { type?: string; text?: string } | undefined;
  return item?.type === "agent_message" && item.text?.trim() ? item.text.trim() : undefined;
}

function codexItem(data: Record<string, unknown>): string | undefined {
  if (data.type !== "item.completed" && data.type !== "item.started") return undefined;
  const item = data.item;
  if (!item || typeof item !== "object") return undefined;
  const record = item as { type?: string; text?: string; command?: string };
  if (record.type === "agent_message" && record.text) return record.text.replace(/\s+/g, " ").slice(0, 240);
  if (record.command) return `Tool: ${commandLine(record.command)}`;
  if (record.type) return `Tool: ${record.type}`;
  return undefined;
}

function toolName(data: Record<string, unknown>): string | undefined {
  const candidates = [data.tool_call, data.toolCall, data.tool];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as { name?: string; tool?: string; type?: string };
    const name = record.name || record.tool || record.type;
    if (name) return `Tool: ${name}`;
  }
  if (typeof data.subtype === "string" && data.type === "tool_call") return `Tool: ${data.subtype}`;
  return undefined;
}
