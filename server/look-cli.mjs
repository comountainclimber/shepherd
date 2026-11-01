#!/usr/bin/env node
// Asks Shepherd to screenshot a page, for agents whose sandbox cannot start a browser.
// node "$SHEPHERD_LOOK" URL [--width N] [--height N] [--full] [--click SELECTOR] [--type TEXT] [--press KEY] [--wait MS]

const USAGE =
  'Usage: node "$SHEPHERD_LOOK" http://localhost:PORT/path [--width 390] [--height 800] [--full] [--click "CSS selector"] [--type "text"] [--press Enter] [--wait 500]';

function parse(argv) {
  const request = { steps: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`${arg} needs a value.`);
      i += 1;
      return next;
    };
    if (arg === "--width" || arg === "--height") request[arg.slice(2)] = Number(value());
    else if (arg === "--full") request.full = true;
    else if (arg === "--click") request.steps.push({ click: value() });
    else if (arg === "--type") request.steps.push({ type: value() });
    else if (arg === "--press") request.steps.push({ press: value() });
    else if (arg === "--wait") request.steps.push({ wait: Number(value()) });
    else if (arg === "--help" || arg === "-h") throw new Error(USAGE);
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}.\n${USAGE}`);
    else if (!request.url) request.url = arg;
    else throw new Error(`Give one URL.\n${USAGE}`);
  }
  if (!request.url) throw new Error(USAGE);
  return request;
}

async function main() {
  const server = process.env.SHEPHERD_URL;
  const taskId = process.env.SHEPHERD_TASK_ID;
  if (!server || !taskId) throw new Error("SHEPHERD_URL and SHEPHERD_TASK_ID are not set. Shepherd sets them for the agents it runs.");
  const request = parse(process.argv.slice(2));
  let response;
  try {
    response = await fetch(new URL("/api/look", server), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, taskId }),
    });
  } catch (error) {
    throw new Error(`Could not reach Shepherd at ${server}: ${error.message}`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Shepherd refused (${response.status}).`);
  const lines = [
    `Screenshot of ${body.url}${body.title ? ` (“${body.title}”)` : ""} at ${body.width}×${body.height}:`,
    body.path,
    "Open it with your image viewing tool to see it.",
    body.errors.length ? ["Errors on the page:", ...body.errors.map((line) => `- ${line}`)].join("\n") : "The page logged no errors.",
  ];
  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
