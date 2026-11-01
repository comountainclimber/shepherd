import { mkdtempSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blankTask } from "../src/model/factory";
import { LOOK_LIMIT } from "../src/model/reducer";
import { createEngine, tabAction } from "./engine";
import { findBrowser, look, type LookRequest } from "./look";
import { LookRefused, createLooks, lookRequest } from "./looks";
import { serverUrl } from "./shepherdApi";

function board() {
  const dir = mkdtempSync(path.join(tmpdir(), "shepherd-looks-"));
  const engine = createEngine(path.join(dir, "state.json"));
  engine.dispatch({ type: "createTask", task: blankTask({ id: "step-1", projectId: "proj-local", name: "Page", objective: "", agentId: "agent-codex", position: { x: 0, y: 0 } }) });
  return { engine, root: path.join(dir, "looks") };
}

describe("look requests", () => {
  it("only looks at pages on this machine", () => {
    expect(lookRequest({ url: "http://localhost:8130/game?x=1#move" }).url).toBe("http://localhost:8130/game?x=1#move");
    expect(lookRequest({ url: "http://127.0.0.1:5000" }).url).toBe("http://127.0.0.1:5000/");
    expect(lookRequest({ url: "http://app.localhost:3000/" }).url).toBe("http://app.localhost:3000/");
    for (const url of ["https://example.com/", "file:///etc/passwd", "http://192.168.1.10/", "not a url", "http://localhost.evil.com/"]) {
      expect(() => lookRequest({ url })).toThrow(LookRefused);
    }
  });

  it("reads clicks, typing, keys and waits, and refuses anything else", () => {
    const request = lookRequest({ url: "http://localhost:1/", width: 390, full: true, steps: [{ click: " #go " }, { type: "e4" }, { press: "Enter" }, { wait: 300 }] });
    expect(request).toEqual({ url: "http://localhost:1/", width: 390, full: true, steps: [{ click: "#go" }, { type: "e4" }, { press: "Enter" }, { wait: 300 }] });
    expect(() => lookRequest({ url: "http://localhost:1/", steps: [{ eval: "alert(1)" }] })).toThrow(LookRefused);
    expect(() => lookRequest({ url: "http://localhost:1/", steps: [{ press: "F12" }] })).toThrow(LookRefused);
  });

  it("is reached on loopback when the server listens on every address", () => {
    expect(serverUrl({ address: "::", family: "IPv6", port: 5174 })).toBe("http://127.0.0.1:5174");
    expect(serverUrl({ address: "::1", family: "IPv6", port: 5174 })).toBe("http://[::1]:5174");
    expect(serverUrl({ address: "127.0.0.1", family: "IPv4", port: 5174 })).toBe("http://127.0.0.1:5174");
    expect(serverUrl(null)).toBeNull();
  });
});

describe("screenshots", () => {
  const png = Buffer.from("not really a png");

  it("keeps the latest screenshots on the board and retains earlier timeline thumbnails on disk", async () => {
    const { engine, root } = board();
    let shots = 0;
    const take = createLooks(engine, root, async (request: LookRequest) => {
      shots += 1;
      await new Promise((resolve) => setTimeout(resolve, 2));
      return { png, title: "Chess", url: request.url, width: request.width ?? 1280, height: 800, errors: shots === 1 ? ["Uncaught Error: boom"] : [] };
    });
    const first = await take({ taskId: "step-1", url: "http://localhost:8130/", width: 390 });
    expect(first.path.startsWith(path.join(root, "step-1"))).toBe(true);
    expect(first.view).toMatch(/^\/api\/looks\/step-1\/[\w]+-390\.png$/);
    expect(first.errors).toEqual(["Uncaught Error: boom"]);
    expect(engine.get().tasks[0]!.looks).toEqual([
      { file: path.basename(first.path), url: "http://localhost:8130/", width: 390, height: 800, at: expect.any(Number), errors: ["Uncaught Error: boom"] },
    ]);

    for (let index = 0; index < LOOK_LIMIT + 2; index += 1) await take({ taskId: "step-1", url: "http://localhost:8130/" });
    const kept = engine.get().tasks[0]!.looks!.map((item) => item.file);
    expect(kept).toHaveLength(LOOK_LIMIT);
    const timelineFiles = engine.timelines.read("step-1").entries.flatMap((entry) => entry.kind === "screenshot" ? [entry.look.file] : []);
    expect(timelineFiles).toHaveLength(LOOK_LIMIT + 3);
    expect(readdirSync(path.join(root, "step-1")).sort()).toEqual(timelineFiles.sort());
  });

  it("refuses an unknown step, an unsafe id, and pages elsewhere, before starting a browser", async () => {
    const { engine, root } = board();
    let started = false;
    const take = createLooks(engine, root, async () => {
      started = true;
      throw new Error("should not start");
    });
    await expect(take({ taskId: "step-2", url: "http://localhost:1/" })).rejects.toThrow("There is no step step-2.");
    await expect(take({ taskId: "../step-1", url: "http://localhost:1/" })).rejects.toThrow(LookRefused);
    await expect(take({ taskId: "step-1", url: "https://example.com/" })).rejects.toThrow(LookRefused);
    expect(started).toBe(false);
  });

  it("cannot be faked by a tab", () => {
    const { engine } = board();
    const look = { file: "x.png", url: "http://localhost:1/", width: 1, height: 1, at: 0, errors: [] };
    expect(tabAction(engine.get(), { type: "looked", id: "step-1", look })).toEqual({ error: "A tab cannot send looked; the server does that itself." });
    expect(tabAction(engine.get(), { type: "updateTask", id: "step-1", patch: { looks: [look] } })).toEqual({ error: "A tab cannot change looks directly." });
  });
});

const browser = findBrowser();

// Seatbelt blocks starting Chrome; UI checks use the browser tool or Shepherd screenshots there.
describe.skipIf(!browser || process.env.CODEX_SANDBOX === "seatbelt")("a real browser", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(`<!doctype html><title>Counter</title>
        <body style="margin:0;background:#fff">
          <button id="add" style="font-size:40px">Add</button>
          <input id="name" />
          <p id="out">0</p>
          <script>
            let count = 0;
            document.getElementById("add").addEventListener("click", () => {
              count += 1;
              document.getElementById("out").textContent = count;
              document.title = "Counter " + count + " " + document.getElementById("name").value;
            });
            console.error("a logged problem");
          </script>
        </body>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("opens the page at the asked size, types, clicks, and reports what the page logged", async () => {
    const result = await look({ url: base, width: 390, height: 600, steps: [{ click: "#name" }, { type: "Ada" }, { click: "#add" }, { click: "#add" }] });
    expect(result.png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(result.png.readUInt32BE(16)).toBe(390);
    expect(result.png.readUInt32BE(20)).toBe(600);
    expect(result.title).toBe("Counter 2 Ada");
    expect(result.errors.some((error) => error.includes("a logged problem"))).toBe(true);
  }, 60_000);

  it("explains a click on something that is not there", async () => {
    await expect(look({ url: base, steps: [{ click: "#missing" }] })).rejects.toThrow(/#missing/);
  }, 60_000);

  it("explains a page whose server is not running", async () => {
    await expect(look({ url: "http://127.0.0.1:9/" })).rejects.toThrow(/server running/);
  }, 60_000);
});
