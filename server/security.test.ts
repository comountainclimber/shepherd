import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startServer } from "./standalone";

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function start() {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-security-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const distDir = path.join(root, "dist");
  mkdirSync(distDir);
  writeFileSync(path.join(distDir, "index.html"), "<!doctype html><title>Shepherd</title><div id='root'></div>");
  const app = await startServer({
    port: 0,
    distDir,
    dataDir: path.join(root, "board"),
    projectsDir: path.join(root, "projects"),
    helpersDir: path.resolve("server"),
  });
  cleanup.push(() => app.close());
  return app;
}

describe("page token authentication", () => {
  it.each(["/", "/t/goal-1/s/step-2", "/t/goal%201/s/step%202", "/apiary"])("unlocks %s and redirects to the same path", async (pathname) => {
    const app = await start();
    const response = await fetch(`${app.url}${pathname}?token=${app.security.token}`, { redirect: "manual" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(pathname);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toBe(`shepherd_${new URL(app.url).port}=${app.security.token}; Path=/; HttpOnly; SameSite=Strict`);
    const cookie = setCookie!.split(";")[0];
    expect((await fetch(`${app.url}/api/state`, { headers: { cookie } })).status).toBe(200);
    const page = await fetch(new URL(response.headers.get("location")!, app.url), { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<title>Shepherd</title>");
  });

  it.each(["/", "/t/goal-1/s/step-2"])("keeps other query parameters on %s while removing every token", async (pathname) => {
    const app = await start();
    const response = await fetch(`${app.url}${pathname}?view=output&token=${app.security.token}&filter=needs%20review&view=log&token=${app.security.token}`, { redirect: "manual" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${pathname}?view=output&filter=needs+review&view=log`);
  });

  it("keeps redirects with a double slash path on Shepherd's own origin", async () => {
    const app = await start();
    const response = await new Promise<{ status: number | undefined; location: string | undefined }>((resolve, reject) => {
      const req = httpRequest(app.url, { path: `/t/..//example.test/?token=${app.security.token}` }, (res) => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location });
      });
      req.on("error", reject);
      req.end();
    });
    expect(response.status).toBe(303);
    expect(response.location).toBe(`${app.url}//example.test/`);
  });

  it.each(["/", "/t/goal-1/s/step-2"])("refuses wrong tokens and non-GET unlocks on %s", async (pathname) => {
    const app = await start();
    for (const [method, token] of [["GET", "wrong"], ["GET", ""], ["POST", app.security.token], ["HEAD", app.security.token]]) {
      const response = await fetch(`${app.url}${pathname}?token=${token}`, { method, redirect: "manual" });
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it.each(["/api", "/api/", "/api/state"])("does not authenticate %s using a query token", async (pathname) => {
    const app = await start();
    for (const token of [app.security.token, "wrong"]) {
      const response = await fetch(`${app.url}${pathname}?token=${token}`, { redirect: "manual" });
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("serves a task page without a token", async () => {
    const app = await start();
    const response = await fetch(`${app.url}/t/goal-1`, { redirect: "manual" });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toContain("<title>Shepherd</title>");
  });
});
