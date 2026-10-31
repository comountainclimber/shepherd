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
  if (type === "error") {
    return { chatId, done: true, ok: false, summary: stringField(data, ["message", "error"]) || "Agent failed" };
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
  if (record.command) return `Tool: ${record.command}`.slice(0, 240);
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
