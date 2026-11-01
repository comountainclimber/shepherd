import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

export type LookStep = { click: string } | { type: string } | { press: string } | { wait: number };

export interface LookRequest {
  url: string;
  width?: number;
  height?: number;
  /** The whole page, not just the first screenful. */
  full?: boolean;
  /** Done in order once the page has loaded, before the screenshot. */
  steps?: LookStep[];
}

export interface LookResult {
  png: Buffer;
  title: string;
  url: string;
  width: number;
  height: number;
  errors: string[];
}

/** A problem with the page or the request, worth showing the agent as it is. */
export class LookError extends Error {}

const BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
];

export function findBrowser(env: NodeJS.ProcessEnv = process.env): string | null {
  const chosen = env.SHEPHERD_CHROME?.trim();
  if (chosen) return existsSync(chosen) ? chosen : null;
  return BROWSERS.find((file) => existsSync(file)) ?? null;
}

export const LOOK_SIZE = { minWidth: 240, maxWidth: 2560, minHeight: 240, maxHeight: 2000, fullHeight: 8000 };
const LOAD_TIMEOUT_MS = 15_000;
const LOOK_TIMEOUT_MS = 45_000;
const MAX_STEPS = 40;
const MAX_ERRORS = 20;

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  Space: { code: "Space", keyCode: 32, text: " " },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
};

export const LOOK_KEYS = Object.keys(KEYS);

const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value! : fallback)));

/** Opens the page in a headless browser with a fresh profile, does the steps, and screenshots it. */
export async function look(request: LookRequest, browser = findBrowser()): Promise<LookResult> {
  if (!browser) throw new LookError("Shepherd found no Chrome, Chromium or Edge to look with. Set SHEPHERD_CHROME to a browser's path.");
  const width = clamp(request.width, 1280, LOOK_SIZE.minWidth, LOOK_SIZE.maxWidth);
  const height = clamp(request.height, 800, LOOK_SIZE.minHeight, LOOK_SIZE.maxHeight);
  const profile = mkdtempSync(path.join(tmpdir(), "shepherd-look-"));
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--remote-debugging-pipe",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--hide-scrollbars",
      "--mute-audio",
      "--use-mock-keychain",
      "--password-store=basic",
      `--window-size=${width},${height}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], detached: true },
  );
  const cdp = new Cdp(child.stdio[3] as Writable, child.stdio[4] as Readable);
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2000);
  });
  const exited = new Promise<never>((_, reject) => {
    child.once("error", (error) => reject(new LookError(`Could not start the browser: ${error.message}`)));
    child.once("exit", () => reject(new LookError(`The browser quit before the screenshot.${stderr.trim() ? ` ${stderr.trim().split("\n").at(-1)}` : ""}`)));
  });
  exited.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LookError(`Looking at ${request.url} took longer than ${LOOK_TIMEOUT_MS / 1000}s.`)), LOOK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([shoot(cdp, request, width, height), exited, timeout]);
  } finally {
    clearTimeout(timer);
    await Promise.race([cdp.send("Browser.close").catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 1000))]);
    stop(child);
    cdp.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function shoot(cdp: Cdp, request: LookRequest, width: number, height: number): Promise<LookResult> {
  const { targetId } = (await cdp.send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
  const { sessionId } = (await cdp.send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
  const page = (method: string, params: Record<string, unknown> = {}) => cdp.send(method, params, sessionId);
  const errors: string[] = [];
  const noteError = (text: string) => {
    const line = text.trim().split("\n").slice(0, 3).join(" ").slice(0, 400);
    if (line && errors.length < MAX_ERRORS && !errors.includes(line)) errors.push(line);
  };
  let loaded: () => void = () => undefined;
  const load = new Promise<void>((resolve) => (loaded = resolve));
  cdp.listen((message) => {
    if (message.sessionId !== sessionId) return;
    const params = (message.params ?? {}) as Record<string, any>;
    if (message.method === "Page.loadEventFired") loaded();
    else if (message.method === "Runtime.exceptionThrown") noteError(exceptionText(params.exceptionDetails));
    else if (message.method === "Runtime.consoleAPICalled" && (params.type === "error" || params.type === "assert")) {
      noteError((params.args ?? []).map(remoteText).join(" "));
    } else if (message.method === "Log.entryAdded" && params.entry?.level === "error" && !/\/favicon\.ico(\?|$)/.test(params.entry.url ?? "")) {
      noteError(`${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ""}`);
    }
  });
  await Promise.all([page("Page.enable"), page("Runtime.enable"), page("Log.enable")]);
  await page("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  const navigation = (await page("Page.navigate", { url: request.url })) as { errorText?: string };
  if (navigation.errorText) throw new LookError(`Could not open ${request.url}: ${navigation.errorText}. Is its server running?`);
  const finished = await Promise.race([load.then(() => true), pause(LOAD_TIMEOUT_MS).then(() => false)]);
  if (!finished) noteError(`The page had not finished loading after ${LOAD_TIMEOUT_MS / 1000}s.`);
  await settle(page);
  for (const step of (request.steps ?? []).slice(0, MAX_STEPS)) await act(page, step);
  if (request.steps?.length) await settle(page);
  let shotHeight = height;
  if (request.full) {
    const metrics = (await page("Page.getLayoutMetrics")) as { cssContentSize?: { height: number } };
    shotHeight = clamp(metrics.cssContentSize?.height, height, height, LOOK_SIZE.fullHeight);
    if (shotHeight !== height) {
      await page("Emulation.setDeviceMetricsOverride", { width, height: shotHeight, deviceScaleFactor: 1, mobile: false });
      await pause(150);
    }
  }
  const shot = (await page("Page.captureScreenshot", { format: "png" })) as { data: string };
  const where = (await evaluate(page, "[document.title, location.href]")) as [string, string] | undefined;
  return {
    png: Buffer.from(shot.data, "base64"),
    title: where?.[0] ?? "",
    url: where?.[1] ?? request.url,
    width,
    height: shotHeight,
    errors,
  };
}

/** Waits for fonts and a couple of frames, so what renders after load is in the picture. */
async function settle(page: (method: string, params?: Record<string, unknown>) => Promise<unknown>) {
  await evaluate(
    page,
    "Promise.race([Promise.all([document.fonts ? document.fonts.ready : null, new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))]), new Promise((r) => setTimeout(r, 2000))]).then(() => true)",
  ).catch(() => undefined);
  await pause(250);
}

async function act(page: (method: string, params?: Record<string, unknown>) => Promise<unknown>, step: LookStep) {
  if ("wait" in step) {
    await pause(clamp(step.wait, 0, 0, 10_000));
    return;
  }
  if ("type" in step) {
    await page("Input.insertText", { text: String(step.type) });
    await pause(100);
    return;
  }
  if ("press" in step) {
    const key = KEYS[step.press];
    if (!key) throw new LookError(`Shepherd cannot press ${step.press}. It knows ${LOOK_KEYS.join(", ")}.`);
    const name = step.press === "Space" ? " " : step.press;
    const base = { key: name, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.keyCode };
    await page("Input.dispatchKeyEvent", { type: key.text ? "keyDown" : "rawKeyDown", ...base, ...(key.text ? { text: key.text } : {}) });
    await page("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    await pause(150);
    return;
  }
  const selector = String(step.click);
  const point = (await evaluate(
    page,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: "center", inline: "center" }); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`,
  )) as [number, number] | null;
  if (!point) throw new LookError(`Nothing on the page matches ${selector}, so Shepherd could not click it.`);
  const [x, y] = point;
  await page("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await page("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await page("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await pause(200);
}

async function evaluate(page: (method: string, params?: Record<string, unknown>) => Promise<unknown>, expression: string): Promise<unknown> {
  const reply = (await page("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })) as {
    result?: { value?: unknown };
    exceptionDetails?: unknown;
  };
  if (reply.exceptionDetails) throw new LookError(`The page threw: ${exceptionText(reply.exceptionDetails)}`);
  return reply.result?.value;
}

function exceptionText(details: any): string {
  const description = details?.exception?.description ?? details?.exception?.value ?? details?.text ?? "An error";
  const where = details?.url ? ` (${details.url}:${(details.lineNumber ?? 0) + 1})` : "";
  return `${String(description).split("\n")[0]}${where}`;
}

function remoteText(arg: any): string {
  if (arg?.value !== undefined) return typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value);
  return String(arg?.description ?? arg?.type ?? "");
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
  sessionId?: string;
}

/** The DevTools protocol over --remote-debugging-pipe: JSON messages ended by a NUL byte. */
class Cdp {
  private next = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private listeners = new Set<(message: CdpMessage) => void>();
  private buffer = Buffer.alloc(0);
  private closed = false;

  constructor(
    private input: Writable,
    output: Readable,
  ) {
    input.on("error", () => this.close());
    output.on("error", () => this.close());
    output.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (let end = this.buffer.indexOf(0); end >= 0; end = this.buffer.indexOf(0)) {
        const raw = this.buffer.subarray(0, end).toString("utf8");
        this.buffer = this.buffer.subarray(end + 1);
        let message: CdpMessage;
        try {
          message = JSON.parse(raw) as CdpMessage;
        } catch {
          continue;
        }
        const waiting = message.id ? this.pending.get(message.id) : undefined;
        if (waiting) {
          this.pending.delete(message.id!);
          if (message.error) waiting.reject(new Error(message.error.message));
          else waiting.resolve(message.result ?? {});
        } else {
          for (const listener of this.listeners) listener(message);
        }
      }
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("The browser connection is closed."));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }

  listen(listener: (message: CdpMessage) => void) {
    this.listeners.add(listener);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const waiting of this.pending.values()) waiting.reject(new Error("The browser connection closed."));
    this.pending.clear();
    this.listeners.clear();
    this.input.destroy();
  }
}
