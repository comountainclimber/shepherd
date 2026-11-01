import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markedCount } from "../src/model/acceptance";
import { isFullyVerified } from "../src/model/verify";
import { startDemo, DEMO_MODELS } from "./demo";
import * as runners from "./runner";
import * as models from "./models";

const cleanup: (() => unknown | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function demo() {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-demo-test-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const distDir = path.join(root, "dist");
  mkdirSync(distDir);
  writeFileSync(path.join(distDir, "index.html"), "<!doctype html><title>Shepherd</title>");
  const personal = path.join(root, "personal");
  mkdirSync(personal);
  const sentinel = path.join(personal, "state.json");
  writeFileSync(sentinel, "keep this board");
  vi.stubEnv("SHEPHERD_DATA_DIR", personal);
  vi.stubEnv("SHEPHERD_PROJECTS_DIR", personal);
  const runner = vi.spyOn(runners, "createRunner");
  const catalog = vi.spyOn(models, "modelCatalog");
  const app = await startDemo({ port: 0, distDir });
  cleanup.push(() => app.close());
  const request = (route: string, body?: unknown) => fetch(`${app.url}/api/${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${app.security.token}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { app, request, sentinel, runner, catalog, personal };
}

describe("the throwaway demo", () => {
  it("creates a complete example through actions, with retries, progress and real timeline routes", async () => {
    const { app, request } = await demo();
    const board = app.engine.get();
    expect(board.projects.map((project) => project.name)).toEqual(["Slice", "Pocket Garden"]);
    expect(board.goals).toHaveLength(3);
    expect(board.tasks).toHaveLength(8);
    expect(board.tasks.filter(isFullyVerified)).toHaveLength(4);
    expect(board.tasks.filter((task) => task.status === "running")).toHaveLength(2);
    expect(board.tasks.find((task) => task.runner === "human")?.status).toBe("completed");
    expect(markedCount(board.tasks.find((task) => task.id === "demo-recovery")!)).toBe(2);
    const wallet = board.tasks.find((task) => task.id === "demo-wallet")!;
    expect(markedCount(wallet)).toBe(4);
    expect(wallet.verification.find((check) => check.kind === "work")?.result?.items).toHaveLength(4);
    const timeline = await (await request("tasks/demo-wallet/timeline")).json();
    expect(timeline.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "check_ended", ok: false }),
      expect.objectContaining({ kind: "run_started", text: "Run 2 · retry · demo" }),
      expect.objectContaining({ kind: "check_ended", ok: true }),
    ]));
    expect(board.tasks.at(-1)).toMatchObject({ name: "Open a merge request", pushBeforeRun: true, status: "queued" });
    expect(board.dependencies.filter((dep) => dep.source === "demo-plan").length).toBeGreaterThan(1);
    expect((await request("state")).status).toBe(200);
  });

  it("never creates a runner, reads personal model settings, or uses configured board folders", async () => {
    const { app, request, sentinel, runner, catalog, personal } = await demo();
    expect(app.root.startsWith(path.join(tmpdir(), "shepherd-demo-"))).toBe(true);
    expect(app.root).not.toBe(personal);
    expect(readFileSync(sentinel, "utf8")).toBe("keep this board");
    expect(await (await request("models")).json()).toEqual(DEMO_MODELS);
    expect(await (await request("agents")).json()).toMatchObject({ codex: true, claude: true, workspace: "Demo workspace" });
    for (const route of ["commands", "draft", "look", "goals/goal-apple-pay/open", "projects"]) {
      expect((await request(route, { command: "runPlan", goalId: "goal-apple-pay" })).status).toBe(409);
    }
    expect((await request("actions", { action: { type: "createProject", project: { id: "external", name: "External", summary: "", repo: personal } } })).status).toBe(400);
    await request("actions", { action: { type: "setPlanRunning", goalId: "goal-apple-pay", running: true } });
    expect(runner).not.toHaveBeenCalled();
    expect(catalog).not.toHaveBeenCalled();
    expect((await fetch(`${app.url}/api/state`)).status).toBe(403);
    await app.close();
    cleanup.pop();
    expect(existsSync(app.root)).toBe(false);
    expect(readFileSync(sentinel, "utf8")).toBe("keep this board");
  });
});
