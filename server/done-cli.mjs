#!/usr/bin/env node

const USAGE = 'Usage: node "$SHEPHERD_DONE" ITEM "How you confirmed it"\n       node "$SHEPHERD_DONE" ITEM --undo';

async function main() {
  const [number, note, ...extra] = process.argv.slice(2);
  if (!/^[1-9]\d*$/.test(number ?? "") || !note?.trim() || extra.length) throw new Error(USAGE);
  const { SHEPHERD_URL: server, SHEPHERD_TASK_ID: taskId, SHEPHERD_RUN_ID: run, SHEPHERD_DONE_KEYS: keys } = process.env;
  if (!server || !taskId || !run || !keys) throw new Error("Shepherd sets this script's environment for the agents it runs.");
  const item = Number(number);
  const key = JSON.parse(keys)[item - 1];
  if (!key) throw new Error("There is no Done when item with that number in your prompt.");
  const met = note !== "--undo";
  const response = await fetch(new URL("/api/progress", server), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId, run: Number(run), item, key, met, ...(met ? { note } : {}) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Shepherd refused (${response.status}).`);
  console.log(`Done when ${item}: ${met ? "marked as met" : "mark taken back"}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
