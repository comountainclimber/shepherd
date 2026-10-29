import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentCommand, exitError, inside, overlaps, runCheckCommand } from "./shepherdApi";

describe("check commands", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shepherd-check-"));
  writeFileSync(path.join(dir, "sample.txt"), "one two three\n");

  it("runs in the project folder and passes on exit 0", async () => {
    const result = await runCheckCommand(dir, "wc -w < sample.txt");
    expect(result.exitCode).toBe(0);
    expect(result.output.trim()).toBe("3");
    expect(result.timedOut).toBe(false);
  });

  it("captures stderr and the exit code on failure", async () => {
    const result = await runCheckCommand(dir, "echo nope >&2; exit 3");
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain("nope");
  });

  it("stops a command that runs too long", async () => {
    const result = await runCheckCommand(dir, "sleep 5", 200);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeLessThan(3000);
  });
});

describe("agent commands", () => {
  it("starts Codex in a writable sandbox", () => {
    const { cmd, args } = agentCommand("codex", "Do it", null);
    expect(cmd).toBe("codex");
    expect(args.slice(0, 1)).toEqual(["exec"]);
    expect(args).toContain("--sandbox");
    expect(args.at(-1)).toBe("Do it");
  });

  it("resumes Codex without flags that resume rejects", () => {
    const { args } = agentCommand("codex", "Fix it", "session-1");
    expect(args.slice(0, 3)).toEqual(["exec", "resume", "session-1"]);
    expect(args).not.toContain("--sandbox");
    expect(args).toContain('sandbox_mode="workspace-write"');
    expect(args.at(-1)).toBe("Fix it");
  });

  it("resumes Claude with its session id", () => {
    const { cmd, args } = agentCommand("claude", "Fix it", "chat-1");
    expect(cmd).toBe("claude");
    expect(args).toEqual(expect.arrayContaining(["--resume", "chat-1"]));
    expect(args.at(-1)).toBe("Fix it");
  });
});

describe("run failures", () => {
  it("reports the CLI's error line instead of the usage text", () => {
    const stderr = "error: unexpected argument '--sandbox' found\n\n  tip: use '-- --sandbox'\n\nUsage: codex exec resume";
    expect(exitError(stderr)).toBe("error: unexpected argument '--sandbox' found");
  });

  it("falls back to the last line when nothing says error", () => {
    expect(exitError("starting\nmodel overloaded")).toBe("model overloaded");
    expect(exitError("")).toBeUndefined();
  });
});

describe("task folders", () => {
  const base = path.resolve("/tmp/workspace");

  it("keeps folders inside the workspace", () => {
    expect(inside(base, "word-count")).toBe(path.join(base, "word-count"));
    expect(inside(base, "")).toBe(base);
    expect(inside(base, "../elsewhere")).toBeNull();
    expect(inside(base, "/etc")).toBeNull();
  });

  it("treats nested folders as overlapping but siblings as separate", () => {
    const project = path.join(base, "word-count");
    expect(overlaps(project, path.join(project, "implement"))).toBe(true);
    expect(overlaps(path.join(project, "implement"), path.join(project, "verify"))).toBe(false);
    expect(overlaps(project, path.join(base, "word-count-2"))).toBe(false);
  });
});
