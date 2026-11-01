import { execFile } from "node:child_process";
import { request as httpRequest } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createServer as createViteServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptanceItems } from "../src/model/acceptance";
import { shepherdApi } from "./shepherdApi";
import * as screenshots from "./look";
import { startServer } from "./standalone";

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function folders() {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-app-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const distDir = path.join(root, "dist");
  mkdirSync(distDir);
  writeFileSync(path.join(distDir, "index.html"), "<!doctype html><title>Shepherd</title><div id='root'></div>");
  writeFileSync(path.join(distDir, "app.js"), "console.log('Shepherd');");
  return { root, distDir, dataDir: path.join(root, "board"), projectsDir: path.join(root, "projects"), helpersDir: path.resolve("server") };
}

// fetch keeps idle connections to a closed server and reuses them for the next server on the same port.
let lastPort = 5194;
const freshPort = () => (lastPort += 10);

async function start() {
  const dirs = folders();
  const app = await startServer({ ...dirs, port: freshPort() });
  cleanup.push(() => app.close());
  const headers = { authorization: `Bearer ${app.security.token}` };
  return { ...app, ...dirs, headers };
}

async function cookieFor(address: string) {
  const login = await fetch(address, { redirect: "manual" });
  expect(login.status).toBe(303);
  expect(login.headers.get("location")).toBe("/");
  expect(login.headers.get("referrer-policy")).toBe("no-referrer");
  expect(login.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Strict/);
  return login.headers.get("set-cookie")!.split(";")[0];
}

describe("the standalone server", () => {
  it("serves the built page and authenticates API, stream, screenshot and report routes", async () => {
    const app = await start();
    expect(app.url).toMatch(/^http:\/\/127\.0\.0\.1:5\d+/);
    expect(app.http.address()).toMatchObject({ address: "127.0.0.1" });
    expect(await (await fetch(app.url)).text()).toContain("<title>Shepherd</title>");
    expect((await fetch(`${app.url}/app.js`)).headers.get("content-type")).toContain("javascript");
    expect((await fetch(`${app.url}/missing.js`)).status).toBe(404);
    expect((await fetch(`${app.url}/package.json`)).status).toBe(404);
    for (const route of ["state", "stream", "looks/step/test.png", "evidence/step/report.html", "unknown"]) {
      expect((await fetch(`${app.url}/api/${route}`)).status).toBe(403);
      expect((await fetch(`${app.url}/api/${route}`, { headers: { authorization: "Bearer wrong" } })).status).toBe(403);
    }
    const cookie = await cookieFor(app.address);
    expect((await fetch(`${app.url}/api/state`, { headers: { cookie } })).status).toBe(200);
    expect((await fetch(`${app.url}/api/state`, { headers: app.headers })).status).toBe(200);
    const stream = await fetch(`${app.url}/api/stream`, { headers: { cookie } });
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const reader = stream.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('data: {"revision"');
    await reader.cancel();
    const report = path.join(app.dataDir, "evidence", "step");
    mkdirSync(report, { recursive: true });
    writeFileSync(path.join(report, "report.html"), "<h1>Report</h1>");
    const response = await fetch(`${app.url}/api/evidence/step/report.html`, { headers: { cookie } });
    expect(await response.text()).toContain("<h1>Report</h1>");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    expect(JSON.parse(readFileSync(path.join(app.dataDir, "state.json"), "utf8"))).toHaveProperty("state");
    expect(app.engine.get().workspace).toBeUndefined();
    expect((await (await fetch(`${app.url}/api/agents`, { headers: app.headers })).json()).workspace).toBe(app.projectsDir);
  });

  it("refuses foreign and opaque origins even with a valid token or cookie, and refuses other hosts", async () => {
    const app = await start();
    const cookie = await cookieFor(app.address);
    for (const origin of ["https://example.test", "null", "http://localhost:5194"]) {
      for (const route of ["/api/state", "/api/stream", "/api/looks/step/a.png", "/api/evidence/step/report.html", "/"]) {
        expect((await fetch(`${app.url}${route}`, { headers: { ...app.headers, cookie, origin } })).status).toBe(403);
      }
      expect((await fetch(app.address, { redirect: "manual", headers: { origin } })).status).toBe(403);
    }
    expect((await fetch(`${app.url}/api/state`, { headers: { ...app.headers, origin: app.url } })).status).toBe(200);
    expect((await fetch(`${app.url}/api/state`, { headers: { ...app.headers, "sec-fetch-site": "cross-site" } })).status).toBe(403);
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(`${app.url}/api/state`, { headers: { ...app.headers, host: "example.test" } }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject);
      req.end();
    });
    expect(hostStatus).toBe(403);
    for (const requestPath of ["http://[", "http://example.test/api/state"]) {
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const address = new URL(app.url);
        const req = httpRequest({ hostname: address.hostname, port: address.port, path: requestPath, headers: app.headers }, (res) => { res.resume(); resolve(res.statusCode); });
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(403);
    }
    expect((await fetch(`${app.url}/?token=wrong`, { redirect: "manual" })).status).toBe(403);
  });

  it("finds the next free loopback port and generates independent tokens", async () => {
    const app = await start();
    const other = await startServer({ ...folders(), port: Number(new URL(app.url).port) });
    cleanup.push(() => other.close());
    expect(Number(new URL(other.url).port)).toBeGreaterThan(Number(new URL(app.url).port));
    expect(other.security.token).not.toBe(app.security.token);
    expect((await fetch(`${other.url}/api/state`, { headers: app.headers })).status).toBe(403);
  });

  it("runs the agents' screenshot and progress helpers with bearer credentials", async () => {
    vi.spyOn(screenshots, "look").mockResolvedValue({ png: Buffer.from("png"), title: "Example", url: "http://127.0.0.1:5199/", width: 390, height: 800, errors: [] });
    const app = await start();
    const response = await fetch(`${app.url}/api/tasks`, {
      method: "POST", headers: { ...app.headers, "content-type": "application/json" },
      body: JSON.stringify({ goal: "goal-proj-local", name: "Build", acceptance: ["Page works"] }),
    });
    const taskId = (await response.json()).tasks[0].id;
    app.engine.dispatch({ type: "setStatus", id: taskId, status: "running" });
    const run = app.engine.timelines.append(taskId, { kind: "run_started", text: "Started" }).run;
    const task = app.engine.get().tasks.find((task) => task.id === taskId)!;
    const env = { ...process.env, SHEPHERD_URL: app.url, SHEPHERD_TOKEN: app.security.token, SHEPHERD_TASK_ID: taskId, SHEPHERD_RUN_ID: String(run), SHEPHERD_DONE_KEYS: JSON.stringify(acceptanceItems(task.acceptance).map((item) => item.key)) };
    const cli = (file: string, args: string[], token = app.security.token) => promisify(execFile)(process.execPath, [path.resolve(`server/${file}-cli.mjs`), ...args], { env: { ...env, SHEPHERD_TOKEN: token } });
    expect((await cli("look", ["http://127.0.0.1:5199/", "--width", "390"])).stdout).toContain("The page logged no errors.");
    const shot = app.engine.get().tasks.find((task) => task.id === taskId)!.looks![0];
    expect((await fetch(`${app.url}/api/looks/${taskId}/${shot.file}`, { headers: app.headers })).status).toBe(200);
    expect((await cli("done", ["1", "Checked the page"])).stdout).toContain("marked as met");
    await expect(cli("look", ["http://127.0.0.1:5199/"], "wrong")).rejects.toThrow("Open the address with the token");
    await expect(cli("done", ["1", "Checked the page"], "wrong")).rejects.toThrow("Open the address with the token");
  });
});

it("protects the same routes and prints the token address in development", async () => {
  const dirs = folders();
  vi.stubEnv("SHEPHERD_DATA_DIR", dirs.dataDir);
  vi.stubEnv("SHEPHERD_PROJECTS_DIR", dirs.projectsDir);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const vite = await createViteServer({ configFile: false, root: dirs.distDir, plugins: [shepherdApi()], server: { host: "127.0.0.1", port: freshPort(), hmr: false, watch: null }, logLevel: "silent" });
  cleanup.push(() => vite.close());
  await vite.listen();
  const address = log.mock.calls.flat().join("\n").match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[a-f0-9]+/)![0];
  const url = new URL(address).origin;
  expect((await fetch(`${url}/api/state`)).status).toBe(403);
  const cookie = await cookieFor(address);
  expect((await fetch(`${url}/api/state`, { headers: { cookie } })).status).toBe(200);
  expect((await fetch(`${url}/api/state`, { headers: { cookie, origin: "https://example.test" } })).status).toBe(403);
});
