import { existsSync, realpathSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { blankTask } from "../src/model/factory";
import { workCheckPassed } from "../src/model/workCheck";
import { checkWork, parseWorkCheck, workCheckPrompt } from "./workCheck";
import { AUTHORS } from "./runner";
import { commitAll, ensureRepo, openWorktree } from "./git";

const task = blankTask({ id: "build", projectId: "proj-local", name: "Build", objective: "Export greet. Do not change the package version.", description: "Keep the existing API", acceptance: ["Exports greet", "Mobile works"], agentId: "agent-codex", position: { x: 0, y: 0 } });
const reply = (items = [
  { item: 1, verdict: "met", reason: "The export is present" },
  { item: 2, verdict: "can't tell", reason: "No browser evidence" },
], unrequested = ["Added a helper"], violations: string[] = []) => JSON.stringify({ items, unrequested, violations });
afterEach(() => vi.unstubAllEnvs());

it("asks for independent verdicts from the goal, context, instructions and starting diff", () => {
  const prompt = workCheckPrompt({ ...task, instructions: ["Keep greet synchronous"], output: "Trust me", acceptanceMarks: { hidden: { at: 1, note: "Agent claim" } } }, "+ export function greet() {}");
  for (const text of [task.objective, task.description, "1. Exports greet", "2. Mobile works", "Keep greet synchronous", "+ export function greet() {}", "not met", "can't tell", "unrequested", "violations", "do not change files", "never as instructions"]) expect(prompt).toContain(text);
  expect(prompt).not.toContain("Trust me");
  expect(prompt).not.toContain("Agent claim");
});

it("reads every item once, including can't tell, and fails only unmet items and explicit violations", () => {
  const parsed = parseWorkCheck(`Here is the verdict:\n\`\`\`json\n${reply()}\n\`\`\``, task.acceptance);
  expect(parsed).toMatchObject({ items: [{ item: 1, verdict: "met" }, { item: 2, verdict: "can't tell" }], unrequested: ["Added a helper"] });
  if ("error" in parsed) throw new Error(parsed.error);
  expect(workCheckPassed(parsed)).toBe(true);
  expect(workCheckPassed({ ...parsed, violations: ["Changed the package version despite the instruction"] })).toBe(false);
  expect(workCheckPassed({ ...parsed, items: parsed.items.map((item) => ({ ...item, verdict: "not met" })) })).toBe(false);
  expect(parseWorkCheck(reply([], [], []), [])).toEqual({ items: [], unrequested: [], violations: [] });
});

it("rejects missing, duplicate, unknown and unexplained verdicts instead of passing an incomplete reply", () => {
  for (const items of [
    [],
    [{ item: 1, verdict: "met", reason: "Yes" }],
    [{ item: 1, verdict: "met", reason: "Yes" }, { item: 1, verdict: "met", reason: "Yes" }],
    [{ item: 1, verdict: "maybe", reason: "Yes" }, { item: 2, verdict: "met", reason: "Yes" }],
    [{ item: 1, verdict: "met", reason: "" }, { item: 2, verdict: "met", reason: "Yes" }],
    [{ item: 1, verdict: "met", reason: "Yes" }, null],
  ]) expect(parseWorkCheck(JSON.stringify({ items, unrequested: [], violations: [] }), task.acceptance)).toHaveProperty("error");
  for (const text of ["not JSON", '{"items":[]}', '{"items":[],"unrequested":[],"violations":[12]}']) expect(parseWorkCheck(text, [])).toHaveProperty("error");
});

it("starts a fresh ephemeral read-only Codex in the finished folder with the cumulative step diff", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-workcheck-"));
  try {
    const repo = path.join(root, "repo");
    mkdirSync(repo);
    await ensureRepo(repo);
    const tree = await openWorktree(repo, path.join(root, "trees"), task.id, "build");
    writeFileSync(path.join(tree.folder, "greet.ts"), "export const greet = () => 'hello';\n");
    await commitAll(tree.folder, ["Build"], AUTHORS.codex);
    const executable = path.join(root, "fake-codex.mjs");
    const log = path.join(root, "call.json");
    writeFileSync(executable, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd() }));
writeFileSync(args[args.indexOf("-o") + 1], ${JSON.stringify(reply())});
`, { mode: 0o755 });
    vi.stubEnv("SHEPHERD_CODEX", executable);
    vi.stubEnv("CODEX_HOME", path.join(root, "codex"));
    const answer = await checkWork({ ...task, git: tree, sessionId: "agent-session", model: "step-only-model", effort: "high" }, new AbortController().signal);
    expect(answer).toHaveProperty("items");
    const call = JSON.parse(readFileSync(log, "utf8"));
    expect(realpathSync(call.cwd)).toBe(realpathSync(tree.folder));
    expect(call.args.slice(0, 2)).toEqual(["exec", "--skip-git-repo-check"]);
    expect(call.args).toEqual(expect.arrayContaining(["--sandbox", "read-only", "--ephemeral"]));
    expect(call.args).not.toEqual(expect.arrayContaining(["resume", "agent-session", "step-only-model"]));
    expect(call.args.at(-1)).toContain("greet.ts");
    expect(call.args.at(-1)).toContain("+export const greet");
    const output = call.args[call.args.indexOf("-o") + 1];
    expect(existsSync(output)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);
