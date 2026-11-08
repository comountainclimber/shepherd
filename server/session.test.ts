import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_MODELS } from "./demo";
import { guideText } from "./guide";
import { removeSession, writeSession, type Session } from "./session";
import { serverUrl, shepherdApi } from "./shepherdApi";
import { startServer } from "./standalone";
import * as startup from "./startup";

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function folders() {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-session-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const distDir = path.join(root, "dist");
  const dataDir = path.join(root, "board");
  mkdirSync(distDir);
  mkdirSync(dataDir, { mode: 0o700 });
  writeFileSync(path.join(distDir, "index.html"), "<!doctype html><title>Shepherd</title>");
  return { distDir, dataDir, projectsDir: path.join(root, "projects") };
}

function readSession(dataDir: string): Session {
  return JSON.parse(readFileSync(path.join(dataDir, "session.json"), "utf8"));
}

describe("session discovery", () => {
  it("serves the guide with a bearer token and refuses requests without it", async () => {
    const app = await startServer({ ...folders(), port: 0 });
    cleanup.push(() => app.close());
    const response = await fetch(`${app.url}/api/guide`, { headers: { authorization: `Bearer ${app.security.token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toBe(guideText(app.url));
    const refused = await fetch(`${app.url}/api/guide`);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: expect.any(String) });
  });

  it("serves the guide address announced in session.json", async () => {
    const dirs = folders();
    const app = await startServer({ ...dirs, port: 0 });
    cleanup.push(() => app.close());
    const session = readSession(dirs.dataDir);
    const response = await fetch(session.guide, { headers: { authorization: `Bearer ${session.token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toBe(guideText(session.url));
  });

  it("announces the bound standalone origin privately and removes it when the server closes", async () => {
    const dirs = folders();
    const app = await startServer({ ...dirs, port: 0 });
    cleanup.push(() => app.close());
    expect(readSession(dirs.dataDir)).toEqual({
      url: app.url,
      token: app.security.token,
      guide: `${app.url}/api/guide`,
      pid: process.pid,
    });
    expect(app.url).toBe(serverUrl(app.http.address()));
    expect(new URL(app.url).port).not.toBe("0");
    expect(statSync(path.join(dirs.dataDir, "session.json")).mode & 0o777).toBe(0o600);
    await new Promise<void>((resolve, reject) => app.http.close((error) => error ? reject(error) : resolve()));
    expect(existsSync(path.join(dirs.dataDir, "session.json"))).toBe(false);
  });

  it("replaces an existing file with private permissions and leaves no temporary file", () => {
    const { dataDir } = folders();
    writeFileSync(path.join(dataDir, "session.json"), "old session", { mode: 0o644 });
    const session = { url: "http://127.0.0.1:5194", token: "replacement", guide: "http://127.0.0.1:5194/api/guide", pid: process.pid };
    writeSession(dataDir, session);
    expect(readSession(dataDir)).toEqual(session);
    expect(statSync(path.join(dataDir, "session.json")).mode & 0o777).toBe(0o600);
    expect(readdirSync(dataDir)).toEqual(["session.json"]);
  });

  it("leaves another token's session alone", () => {
    const { dataDir } = folders();
    const session = { url: "http://127.0.0.1:5195", token: "another-server", guide: "http://127.0.0.1:5195/api/guide", pid: process.pid };
    writeSession(dataDir, session);
    removeSession(dataDir, "old-server");
    expect(readSession(dataDir)).toEqual(session);
    removeSession(dataDir, session.token);
    expect(existsSync(path.join(dataDir, "session.json"))).toBe(false);
    expect(() => removeSession(dataDir, session.token)).not.toThrow();
  });

  it("preserves a newer server's announcement when the first server stops", async () => {
    const dirs = folders();
    const first = await startServer({ ...dirs, port: 0 });
    cleanup.push(() => first.close());
    const second = await startServer({ ...dirs, port: 0 });
    cleanup.push(() => second.close());
    const session = readSession(dirs.dataDir);
    expect(session.token).toBe(second.security.token);
    await first.close();
    expect(readSession(dirs.dataDir)).toEqual(session);
    await second.close();
    expect(existsSync(path.join(dirs.dataDir, "session.json"))).toBe(false);
  });

  it("serves the guide on a demo board without announcing a session", async () => {
    const dirs = folders();
    const app = await startServer({ ...dirs, port: 0, demo: { models: DEMO_MODELS } });
    cleanup.push(() => app.close());
    const response = await fetch(`${app.url}/api/guide`, { headers: { authorization: `Bearer ${app.security.token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toBe(guideText(app.url));
    const refused = await fetch(`${app.url}/api/guide`);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: expect.any(String) });
    expect(existsSync(path.join(dirs.dataDir, "session.json"))).toBe(false);
    app.announce();
    expect(existsSync(path.join(dirs.dataDir, "session.json"))).toBe(false);
    await app.close();
    expect(existsSync(path.join(dirs.dataDir, "session.json"))).toBe(false);
  });

  it("announces the development server's bound origin and cleans up on close", async () => {
    const dirs = folders();
    vi.stubEnv("SHEPHERD_DATA_DIR", dirs.dataDir);
    vi.stubEnv("SHEPHERD_PROJECTS_DIR", dirs.projectsDir);
    vi.spyOn(startup, "startupWarnings").mockResolvedValue([]);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const vite = await createViteServer({ configFile: false, root: dirs.distDir, plugins: [shepherdApi()], server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, logLevel: "silent" });
    cleanup.push(() => vite.close());
    expect(existsSync(path.join(dirs.dataDir, "session.json"))).toBe(false);
    await vite.listen();
    const session = readSession(dirs.dataDir);
    expect(session).toEqual({
      url: serverUrl(vite.httpServer?.address()),
      token: expect.any(String),
      guide: `${session.url}/api/guide`,
      pid: process.pid,
    });
    expect(log.mock.calls.flat().join("\n")).toContain(`${session.url}/?token=${session.token}`);
    expect(statSync(path.join(dirs.dataDir, "session.json")).mode & 0o777).toBe(0o600);
    const response = await fetch(`${session.url}/api/state`, { headers: { authorization: `Bearer ${session.token}` } });
    expect(response.status).toBe(200);
    await response.json();
    const guide = await fetch(session.guide, { headers: { authorization: `Bearer ${session.token}` } });
    expect(guide.status).toBe(200);
    expect(guide.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await guide.text()).toBe(guideText(session.url));
    await vite.close();
    expect(existsSync(path.join(dirs.dataDir, "session.json"))).toBe(false);
  });
});
