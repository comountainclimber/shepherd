import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Look } from "../src/model/types";
import type { Engine } from "./engine";
import { LOOK_KEYS, LookError, look, type LookRequest, type LookResult, type LookStep } from "./look";

export type Shoot = (request: LookRequest) => Promise<LookResult>;

const SAFE_ID = /^[\w.-]{1,120}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);
/** Browsers Shepherd keeps open at once. More requests wait their turn. */
const AT_ONCE = 2;

/** A request Shepherd refuses, with the reason to show whoever asked. */
export class LookRefused extends Error {}

/** Reads a look request from an API body, refusing anything but a page on this machine. */
export function lookRequest(body: unknown): LookRequest {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  let url: URL;
  try {
    url = new URL(typeof raw.url === "string" ? raw.url.trim() : "");
  } catch {
    throw new LookRefused("Say which page, as url, such as http://localhost:8130/.");
  }
  if (!/^https?:$/.test(url.protocol) || !(LOCAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost"))) {
    throw new LookRefused("Shepherd only looks at pages served on this machine, such as http://localhost:8130/.");
  }
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  const steps = Array.isArray(raw.steps) ? raw.steps.map(step) : [];
  return {
    url: url.href,
    ...(number(raw.width) ? { width: number(raw.width) } : {}),
    ...(number(raw.height) ? { height: number(raw.height) } : {}),
    ...(raw.full === true ? { full: true } : {}),
    ...(steps.length ? { steps } : {}),
  };
}

function step(value: unknown): LookStep {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  if (typeof raw.click === "string" && raw.click.trim()) return { click: raw.click.trim() };
  if (typeof raw.type === "string") return { type: raw.type };
  if (typeof raw.press === "string" && LOOK_KEYS.includes(raw.press)) return { press: raw.press };
  if (typeof raw.wait === "number") return { wait: raw.wait };
  throw new LookRefused(`Each step is { click: "selector" }, { type: "text" }, { press: "${LOOK_KEYS.join('" | "')}" } or { wait: ms }.`);
}

export interface LookReply {
  /** Where the PNG is on disk, for the agent to open. */
  path: string;
  /** Where the board serves it. */
  view: string;
  title: string;
  url: string;
  width: number;
  height: number;
  errors: string[];
}

/** Screenshots pages for steps, keeps the PNGs in a folder per step, and records them on the board. */
export function createLooks(engine: Engine, root: string, shoot: Shoot = (request) => look(request)) {
  let active = 0;
  const queue: (() => void)[] = [];
  const turn = async <T>(work: () => Promise<T>): Promise<T> => {
    if (active >= AT_ONCE) await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
    try {
      return await work();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };

  return async function take(body: unknown): Promise<LookReply> {
    const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const taskId = typeof raw.taskId === "string" ? raw.taskId : "";
    if (!SAFE_ID.test(taskId) || !engine.get().tasks.some((task) => task.id === taskId)) {
      throw new LookRefused(taskId ? `There is no step ${taskId}.` : "Say which step is looking, as taskId.");
    }
    const runs = engine.timelines.read(taskId).runs ?? [];
    const timelineRun = runs.length ? Math.max(...runs) : undefined;
    const request = lookRequest(body);
    let result: LookResult;
    try {
      result = await turn(() => shoot(request));
    } catch (error) {
      if (error instanceof LookError) throw new LookRefused(error.message);
      throw error;
    }
    if (!engine.get().tasks.some((task) => task.id === taskId)) throw new LookRefused("This step was deleted while Shepherd was looking.");
    const dir = path.join(root, taskId);
    mkdirSync(dir, { recursive: true });
    const file = `${Date.now().toString(36)}-${result.width}.png`;
    writeFileSync(path.join(dir, file), result.png);
    const record: Look = { file, url: result.url, width: result.width, height: result.height, at: Date.now(), errors: result.errors };
    engine.timelines.append(taskId, { kind: "screenshot", look: record }, timelineRun);
    engine.dispatch({ type: "looked", id: taskId, look: record });
    const kept = new Set((engine.get().tasks.find((task) => task.id === taskId)?.looks ?? []).map((item) => item.file));
    for (const entry of engine.timelines.read(taskId).entries) if (entry.kind === "screenshot") kept.add(entry.look.file);
    for (const name of readdirSync(dir)) if (name.endsWith(".png") && !kept.has(name)) rmSync(path.join(dir, name), { force: true });
    return {
      path: path.join(dir, file),
      view: lookUrl(taskId, file),
      title: result.title,
      url: result.url,
      width: result.width,
      height: result.height,
      errors: result.errors,
    };
  };
}

export function lookUrl(taskId: string, file: string): string {
  return `/api/looks/${encodeURIComponent(taskId)}/${encodeURIComponent(file)}`;
}
