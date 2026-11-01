import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { launchOptions, startupWarnings } from "./startup";

describe("launcher options", () => {
  it("keeps installed data and new projects under the user's home, independent of cwd", () => {
    expect(launchOptions([], {})).toEqual({ port: 5194, open: true, dataDir: path.join(homedir(), ".shepherd"), projectsDir: path.join(homedir(), ".shepherd", "projects") });
  });
  it("accepts folder and port options, with flags taking priority over environment", () => {
    expect(launchOptions(["--port", "5201", "--no-open", "--data-dir", "board", "--projects-dir", "work"], { SHEPHERD_DATA_DIR: "elsewhere", SHEPHERD_PROJECTS_DIR: "other" })).toEqual({ port: 5201, open: false, dataDir: path.resolve("board"), projectsDir: path.resolve("work") });
    expect(launchOptions([], { SHEPHERD_DATA_DIR: "board" }).projectsDir).toBe(path.resolve("board/projects"));
    expect(launchOptions([], { SHEPHERD_PROJECTS_DIR: "work" }).projectsDir).toBe(path.resolve("work"));
  });
  it("explains invalid or missing options", () => {
    for (const args of [["--port", "0"], ["--port", "65536"], ["--port", "3.5"], ["--port", "abc"], ["--data-dir"], ["--projects-dir", "--no-open"], ["--host", "0.0.0.0"]]) expect(() => launchOptions(args, {})).toThrow();
  });
});

it("says plainly when git and both agent CLIs are missing", async () => {
  expect(await startupWarnings(async () => false)).toEqual([
    "Git is missing. Install git before running steps.",
    "Neither Codex nor Claude Code is installed. Install at least one and sign in before running steps.",
  ]);
  expect(await startupWarnings(async (command) => command === "git" || command === "claude")).toEqual([]);
});
