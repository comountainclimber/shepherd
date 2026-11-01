import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as drafting from "./draft";
import { createEngine, type Engine } from "./engine";
import { createLooks } from "./looks";
import { createRunner, type Runner } from "./runner";
import { createSavedSteps } from "./savedSteps";
import { apiHandler } from "./shepherdApi";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function server() {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-goals-api-"));
  const engine = createEngine(path.join(root, "state.json"));
  const sandbox = path.join(root, "sandbox");
  mkdirSync(sandbox);
  const runner = createRunner({ engine, sandbox, worktrees: path.join(root, "worktrees"), evidence: path.join(root, "evidence"), gate: path.join(root, "gate"), loggedIn: async () => false });
  const handler = apiHandler({ engine, runner, sandbox, evidence: path.join(root, "evidence"), looks: path.join(root, "looks"), look: createLooks(engine, path.join(root, "looks")), saved: createSavedSteps(path.join(root, "saved.json")) });
  const http = createServer((req, res) => void handler(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => close(http, runner, engine));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("No test server address");
  const base = `http://127.0.0.1:${address.port}`;
  async function request(route: string, body?: unknown) {
    const response = await fetch(`${base}/api/${route}`, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  return { request, engine, runner };
}

async function close(http: Server, runner: Runner, engine: Engine) {
  runner.close();
  await runner.idle();
  engine.close();
  await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
}

describe("goal API", () => {
  it("lists and creates tasks and accepts steps by goal id or name", async () => {
    const { request, engine } = await server();
    expect((await request("goals")).body.goals).toHaveLength(1);
    const created = await request("goals", { project: "Workspace", name: "Fix timeout", goal: "Finish checkout quickly" });
    expect(created.status).toBe(201);
    const goal = created.body.goal;
    expect(goal).toMatchObject({ projectId: "proj-local", name: "Fix timeout", goal: "Finish checkout quickly", outline: [], running: false, status: "open" });
    expect((await request("goals")).body.goals).toHaveLength(2);
    for (const key of [goal.id, goal.name]) {
      const added = await request("tasks", { goal: key, name: `Step ${key}`, runner: "human" });
      expect(added.status).toBe(201);
      expect(added.body.goal).toBe(goal.id);
    }
    expect(engine.get().tasks.every((task) => task.goalId === goal.id)).toBe(true);
    expect((await request("tasks")).body.projects[0].goals).toHaveLength(2);
  });

  it("lists choices for ambiguous project-only steps, drafts and plan commands", async () => {
    const { request, engine, runner } = await server();
    const created = await request("goals", { project: "Workspace", name: "Other", goal: "Other work" });
    for (const [route, body] of [
      ["tasks", { project: "Workspace", name: "A step" }],
      ["draft", { project: "Workspace", prompt: "Break this up" }],
      ["draft", { projectId: "proj-local" }],
    ] as const) {
      const result = await request(route, body);
      expect(result.status).toBe(400);
      expect(result.body.error).toMatch(/several open tasks.*Workspace.*Other/);
    }
    for (const command of ["runPlan", "stopPlan", "mergePlan"]) {
      expect(await runner.handle({ command, projectId: "proj-local" })).toHaveProperty("error", expect.stringContaining("several open tasks"));
    }
    engine.dispatch({ type: "archiveGoal", id: "goal-proj-local" });
    expect((await request("tasks", { project: "Workspace", name: "Only open task", runner: "human" })).status).toBe(201);
    expect(engine.get().tasks[0]?.goalId).toBe(created.body.goal.id);
  });

  it("drafts from the selected task's text or an explicit prompt without invoking an agent", async () => {
    const draft = vi.spyOn(drafting, "draftSteps").mockResolvedValue([{ name: "Test it", prompt: "Test checkout", depth: 0 }]);
    const { request } = await server();
    const created = await request("goals", { project: "Workspace", name: "Timeout", goal: "Fix checkout" });
    const result = await request("draft", { goal: created.body.goal.id });
    expect(result.status).toBe(200);
    expect(result.body.steps).toHaveLength(1);
    expect(draft.mock.calls[0]?.[0]).toBe("Fix checkout");
    expect((await request("draft", { project: "Workspace", goal: "Timeout", prompt: "Investigate first" })).status).toBe(200);
    expect(draft.mock.calls[1]?.[0]).toBe("Investigate first");
    expect((await request("draft", { goal: "missing" })).body.error).toMatch(/no task missing/);
  });
});
