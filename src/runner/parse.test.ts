import { describe, expect, it } from "vitest";
import { blankTask } from "../model/factory";
import { parseAgentLine } from "./parse";
import { taskPrompt } from "./prompt";

describe("agent stream parsing", () => {
  it("reads assistant text and a finished result", () => {
    const text = parseAgentLine(
      JSON.stringify({
        type: "assistant",
        session_id: "chat-1",
        message: { content: [{ type: "text", text: "Editing the page" }] },
      }),
    );
    expect(text).toEqual({ chatId: "chat-1", activity: "Editing the page", message: "Editing the page" });
    const done = parseAgentLine(JSON.stringify({ type: "result", session_id: "chat-1", result: "Shipped the form" }));
    expect(done?.done).toBe(true);
    expect(done?.ok).toBe(true);
    expect(done?.summary).toBe("Shipped the form");
  });

  it("reads a Codex thread event", () => {
    const started = parseAgentLine(JSON.stringify({ type: "thread.started", thread_id: "thr-9" }));
    expect(started?.chatId).toBe("thr-9");
    const message = parseAgentLine(
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Wrote hello.txt" } }),
    );
    expect(message?.activity).toBe("Wrote hello.txt");
    expect(message?.message).toBe("Wrote hello.txt");
    const long = "Line one.\n\n".repeat(40);
    const report = parseAgentLine(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: long } }));
    expect(report?.message).toBe(long.trim());
    expect(report?.activity!.length).toBeLessThanOrEqual(240);
    const done = parseAgentLine(JSON.stringify({ type: "turn.completed" }));
    expect(done?.done).toBe(true);
    expect(done?.ok).toBe(true);
  });

  it("marks error results as failed", () => {
    const done = parseAgentLine(JSON.stringify({ type: "result", is_error: true, result: "boom" }));
    expect(done?.ok).toBe(false);
  });
});

describe("task prompt", () => {
  const task = {
    ...blankTask({
      id: "t-1",
      projectId: "proj-local",
      name: "Write the parser",
      objective: "Parse RELAY lines",
      agentId: "agent-codex",
      position: { x: 0, y: 0 },
      worktree: "parser",
      acceptance: ["Handles empty lines"],
    }),
    instructions: ["Keep it small", "Add a test"],
  };

  it("includes the objective, done-when list, worktree rules, and earlier instructions", () => {
    const prompt = taskPrompt(task);
    expect(prompt).toContain("Task: Write the parser");
    expect(prompt).toContain("Objective: Parse RELAY lines");
    expect(prompt).toContain("Done when:\n1. Handles empty lines");
    expect(prompt).toContain("this step's own git worktree");
    expect(prompt).toContain("Do not commit, push, or switch branches yourself.");
    expect(prompt).toContain("- Keep it small");
  });

  it("leaves out empty sections", () => {
    const prompt = taskPrompt({ ...task, acceptance: [], instructions: [] });
    expect(prompt).not.toContain("Done when");
    expect(prompt).not.toContain("Earlier instructions");
  });

  it("lists upstream tasks and the files they wrote", () => {
    const prompt = taskPrompt(task, undefined, [
      { name: "Write the contract", objective: "Define RELAY", files: ["contract/CONTRACT.md"], summary: "Defined it" },
    ]);
    expect(prompt).toContain("- Write the contract: Define RELAY");
    expect(prompt).toContain("Files it wrote: contract/CONTRACT.md");
    expect(prompt).toContain("What it reported:\n    Defined it");
  });

  it("keeps upstream agents' summaries from an independent task", () => {
    const prompt = taskPrompt({ ...task, independent: true }, undefined, [
      { name: "Write the contract", objective: "Define RELAY", files: ["contract/CONTRACT.md"], summary: "Defined it, all good" },
    ]);
    expect(prompt).toContain("Files it wrote: contract/CONTRACT.md");
    expect(prompt).not.toContain("all good");
    expect(prompt).toContain("judge it from the files and the criteria above");
  });

  it("sends a new instruction once instead of repeating it as an earlier one", () => {
    const prompt = taskPrompt(task, "Add a test");
    expect(prompt).toContain("New instruction:\nAdd a test");
    expect(prompt.match(/Add a test/g)).toHaveLength(1);
  });

  it("names the check command and, after a failure, includes its output", () => {
    const withCheck = blankTask({
      id: "t-2",
      projectId: "proj-local",
      name: "Write the parser",
      objective: "Parse RELAY lines",
      agentId: "agent-codex",
      position: { x: 0, y: 0 },
      checkCommand: "node parser/test.mjs",
    });
    const first = taskPrompt(withCheck);
    expect(first).toContain("Shepherd runs this command in the current directory: node parser/test.mjs");
    expect(first).not.toContain("It failed last time");

    const failed = {
      ...withCheck,
      verification: withCheck.verification.map((check) =>
        check.kind === "command"
          ? { ...check, state: "pending" as const, exitCode: 1, output: "AssertionError: expected 3", evidence: "node parser/test.mjs exited 1 in 0.2s." }
          : check,
      ),
    };
    const retry = taskPrompt(failed);
    expect(retry).toContain("It failed last time (node parser/test.mjs exited 1 in 0.2s.)");
    expect(retry).toContain("AssertionError: expected 3");
  });
});
