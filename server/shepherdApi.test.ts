import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentCommand, agentEnv, exitError, inside, runCheckCommand, withoutLogLines } from "./runner";

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
    expect(args).toContain("sandbox_workspace_write.network_access=true");
    expect(args.at(-1)).toBe("Do it");
  });

  it("gives Codex an npm cache its sandbox can write to, and leaves Claude's environment alone", () => {
    const env = { PATH: "/bin", NPM_CONFIG_CACHE: "/home/me/.npm" };
    const codex = agentEnv("codex", env);
    expect(codex.NPM_CONFIG_CACHE).toBeUndefined();
    expect(codex.npm_config_cache).toBe(path.join(tmpdir(), "shepherd-npm-cache"));
    expect(codex.PATH).toBe("/bin");
    expect(agentEnv("claude", env)).toBe(env);
  });

  it("resumes Codex without flags that resume rejects", () => {
    const { args } = agentCommand("codex", "Fix it", "session-1");
    expect(args.slice(0, 3)).toEqual(["exec", "resume", "session-1"]);
    expect(args).not.toContain("--sandbox");
    expect(args).toContain('sandbox_mode="workspace-write"');
    expect(args).toContain("sandbox_workspace_write.network_access=true");
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

  it("keeps the CLI's own log lines out of activity and failure reasons", () => {
    const log = "2026-10-30T13:55:25.630702Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed";
    expect(withoutLogLines(`${log}\n${log}`)).toBe("");
    expect(withoutLogLines(`${log}\nwarning: low disk`)).toBe("warning: low disk");
    expect(exitError(`model overloaded\n${log}`)).toBe("model overloaded");
    expect(exitError(log)).toBe(log);
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
});
