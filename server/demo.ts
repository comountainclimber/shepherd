import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { acceptanceItems } from "../src/model/acceptance";
import { blankGoal, blankTask } from "../src/model/factory";
import { CLAUDE_MODELS, type ModelCatalog } from "../src/model/models";
import type { Action, Task } from "../src/model/types";
import type { Engine } from "./engine";
import { startServer } from "./standalone";

export const DEMO_MODELS: ModelCatalog = {
  codex: {
    models: [{ id: "gpt-5.1-codex", name: "GPT-5.1 Codex", hint: "Example model for the demo.", efforts: ["low", "medium", "high"], defaultEffort: "high" }],
    default: { model: null, effort: "high" },
  },
  claude: { models: CLAUDE_MODELS, default: { model: "sonnet", effort: "medium" } },
};

const PROJECT = "proj-pizza";
const GOAL = "goal-apple-pay";

/** Creation goes through the authenticated API; simulated run results use the same engine actions as the runner. */
export async function seedDemo(engine: Engine, post: (actions: Action[]) => Promise<void>) {
  await post([
    { type: "createProject", project: { id: PROJECT, name: "Slice", summary: "Pizza delivery, from the oven to your door.", directory: "slice" } },
    { type: "deleteGoal", id: `goal-${PROJECT}` },
    { type: "createGoal", goal: blankGoal(PROJECT, "Add Apple Pay to checkout", GOAL, "Let customers pay for their pizza with Apple Pay. Keep card checkout working, cover cancellation and retries, and send the work for review.") },
    { type: "createGoal", goal: blankGoal(PROJECT, "Track a delivery", "goal-delivery", "Show a useful delivery estimate and the driver's progress.") },
    { type: "createProject", project: { id: "proj-garden", name: "Pocket Garden", summary: "A small app for remembering what to water.", directory: "pocket-garden" } },
    { type: "createGoal", goal: blankGoal("proj-garden", "Add watering reminders", "goal-reminders", "Send a gentle reminder when a plant needs water.") },
    { type: "deleteGoal", id: "goal-proj-garden" },
  ]);
  const steps = [
    ["plan", "Plan the payment flow", "agent-codex", 0],
    ["wallet", "Build the Apple Pay button", "agent-codex", 1],
    ["session", "Create payment sessions", "agent-claude", 1],
    ["copy", "Approve the checkout copy", null, 1],
    ["recovery", "Handle payment retries", "agent-codex", 1],
    ["test", "Test checkout end to end", "agent-claude", 1],
    ["review", "Review payment safety", "agent-codex", 0],
    ["merge", "Open a merge request", "agent-codex", 0],
  ] as const;
  const acceptance: Record<string, string[]> = {
    plan: ["Map wallet availability and fallback", "Cover success, cancellation and retry"],
    wallet: ["Show Apple Pay on supported devices", "Keep card checkout available", "Use the latest cart total", "Prevent duplicate submissions"],
    session: ["Create one session per checkout attempt", "Validate totals on the server", "Reuse the order id on retry"],
    copy: ["Approve button and cancellation copy"],
    recovery: ["Cancellation keeps the cart", "A retry uses the same order", "Show a useful decline message", "Card checkout still works"],
    test: ["Wallet success creates one order", "Cancel returns to checkout", "Retry does not duplicate an order"],
    review: ["Verify the total on the server", "Confirm no payment secrets reach logs"],
    merge: ["Summarize the changes and checks", "Open a merge request for a person to review"],
  };
  const tasks = steps.map(([id, name, agentId]) => blankTask({
    id: `demo-${id}`, projectId: PROJECT, goalId: GOAL, name,
    objective: id === "merge" ? "Open a merge request with the checkout changes, test results and a short review guide. Leave merging to a person." : `${name} for Slice's Apple Pay checkout. Use the existing payment flow and keep the change focused.`,
    agentId, runner: agentId ? "agent" : "human", position: { x: 0, y: 0 },
    acceptance: acceptance[id],
    ...(agentId && id !== "merge" ? { checkCommand: `npm test -- ${id}`, workCheck: true } : {}),
    independent: id === "review", pushBeforeRun: id === "merge",
  }));
  await post([{ type: "addSteps", goalId: GOAL, after: null, steps: tasks.map((task, index) => ({ task, depth: steps[index][3] })) }]);
  engine.dispatch({ type: "goalRuntime", id: GOAL, patch: { branch: "shepherd/apple-pay-checkout", base: "main" } });

  function dispatch(action: Action) { engine.dispatch(action); }
  function start(task: Task, text = "Run 1 · demo") {
    dispatch({ type: "setStatus", id: task.id, status: "running" });
    engine.timelines.append(task.id, { kind: "run_started", text });
  }
  function check(task: Task, ok = true) {
    dispatch({ type: "startCheck", taskId: task.id });
    dispatch({ type: "recordCheck", taskId: task.id, run: {
      command: task.checkCommand!, exitCode: ok ? 0 : 1, durationMs: 2400,
      output: ok ? "Tests: 12 passed\nCheckout coverage passed." : "Retry coverage: expected one order, received two. Add an idempotency key.",
      steps: [{ name: "Checkout tests", ok, detail: ok ? "12 passed" : "Retry needs an idempotency key" }],
    } });
  }
  function finish(task: Task) {
    if (task.runner === "agent") for (const item of acceptanceItems(task.acceptance)) dispatch({ type: "markAcceptance", id: task.id, key: item.key, note: "Confirmed in checkout tests." });
    dispatch({ type: "setStatus", id: task.id, status: "completed" });
    dispatch({ type: "updateTask", id: task.id, patch: { output: `${task.name} is complete. Covered the happy path and recovery without changing card checkout.`, filesChanged: [`src/checkout/${task.id.slice(5)}.ts`] } });
    engine.timelines.append(task.id, { kind: "run_ended", text: "Finished the work. Running the checks next.", outcome: "completed" });
    if (task.runner === "human") return;
    check(task);
    dispatch({ type: "startWorkCheck", taskId: task.id });
    dispatch({ type: "recordWorkCheck", taskId: task.id, result: {
      items: acceptanceItems(task.acceptance).map((item, index) => ({ key: item.key, item: item.number, verdict: "met", reason: task.id === "demo-wallet" ? ["Capability check hides the wallet on unsupported devices.", "The card form remains available below the wallet.", "The payment request reads the current server total.", "The pending state blocks a second submission."][index] : "The implementation and focused tests cover this item." })),
      violations: [], unrequested: [],
    } });
  }
  start(tasks[0]); finish(tasks[0]);
  start(tasks[1]);
  dispatch({ type: "setStatus", id: tasks[1].id, status: "completed" });
  check(tasks[1], false);
  engine.timelines.append(tasks[1].id, { kind: "run_ended", text: "Check found a duplicate order on retry.", outcome: "failed" });
  await post([{ type: "instruct", id: tasks[1].id, text: "Reuse the checkout id as the idempotency key, then run the retry test again." }]);
  start(tasks[1], "Run 2 · retry · demo"); finish(tasks[1]);
  start(tasks[2]); finish(tasks[2]);
  start(tasks[3]); finish(tasks[3]);
  start(tasks[4]);
  engine.timelines.append(tasks[4].id, { kind: "note", text: "Cancellation now returns to the cart. I am checking retry behavior next." });
  for (const [index, note] of ["Cart contents and delivery address survive cancellation.", "The same checkout id is reused after a retry."].entries()) {
    dispatch({ type: "markAcceptance", id: tasks[4].id, key: acceptanceItems(tasks[4].acceptance)[index].key, note });
  }
  engine.timelines.append(tasks[4].id, { kind: "command", commandId: "retry-tests", text: "npm test -- recovery" });
  engine.timelines.append(tasks[4].id, { kind: "command_end", commandId: "retry-tests", text: "8 tests passed" });
  engine.timelines.append(tasks[4].id, { kind: "note", text: "The retry cases pass. Next: decline messages and a final card checkout check." });
  dispatch({ type: "updateTask", id: tasks[4].id, patch: { activity: "Checking decline messages", filesChanged: ["src/checkout/recovery.ts", "src/checkout/recovery.test.ts"] } });
  // The end-to-end step runs alongside recovery, after the same accepted upstream work.
  start(tasks[5]);
  engine.timelines.append(tasks[5].id, { kind: "note", text: "Wallet success and cancellation pass. Checking the retry flow at a narrow width." });
  dispatch({ type: "updateTask", id: tasks[5].id, patch: { activity: "Checking wallet recovery at 390px" } });
  await post([{ type: "readNotifications" }]);
  engine.flush();
}

export async function startDemo(options: { port?: number; distDir?: string } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "shepherd-demo-"));
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    app = await startServer({ port: options.port ?? 5194, strictPort: true, dataDir: path.join(root, "board"), projectsDir: path.join(root, "projects"), distDir: options.distDir, demo: { models: DEMO_MODELS } });
    const server = app;
    await seedDemo(server.engine, async (actions) => {
      const response = await fetch(`${server.url}/api/actions`, { method: "POST", headers: { authorization: `Bearer ${server.security.token}`, "content-type": "application/json" }, body: JSON.stringify({ actions }) });
      if (!response.ok) throw new Error(`Demo setup failed: ${await response.text()}`);
    });
    return { ...server, root, async close() { await server.close(); rmSync(root, { recursive: true, force: true }); } };
  } catch (error) {
    await app?.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
