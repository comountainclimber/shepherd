# Demo screenshots

These PNGs show **Slice**, a fictional pizza delivery app. All run notes, command output, checks, model choices, and agent availability are sample data. No agent runs to create this board.

## Images

- [task-map-desktop.png](task-map-desktop.png) — 1440 × 1000. Eight steps, parallel work, a human sign-off, running work, and the final merge request step.
- [task-outline-desktop.png](task-outline-desktop.png) — 1440 × 1500. The outline beside the running step, including **2 of 4** Done when items met. More options is collapsed.
- [step-output-desktop.png](step-output-desktop.png) — 1440 × 1250. **Handle payment retries → Output**, with progress notes, Done when updates, a command, and changed files.
- [step-checks-desktop.png](step-checks-desktop.png) — 1440 × 1200. **Build the Apple Pay button → Checks**, with a passing command and four verdicts against the step.
- [projects-tasks-desktop.png](projects-tasks-desktop.png) — 1440 × 1000. The projects and tasks switcher, with two projects and three tasks.
- [draft-desktop.png](draft-desktop.png) — 1440 × 1000. **Slice → Track a delivery**, showing the Draft box, Model, and Thinking. Draft is not submitted.
- [agents-desktop.png](agents-desktop.png) — 1440 × 1000. The Agents page with work assigned to Codex, Claude Code, and you.
- [task-outline-mobile.png](task-outline-mobile.png) — 390 × 1000. The outline and task progress at a phone width.
- [step-output-mobile.png](step-output-mobile.png) — 390 × 1400. The running step's Output and timeline at a phone width.
- [step-checks-mobile.png](step-checks-mobile.png) — 390 × 1300. The passing command and all four work-check verdicts at a phone width.

Every image was opened and visually reviewed. All are below 500 KB and were captured without page errors. The taller inspector captures keep the complete featured content visible. The map and task picker retain the app's normal shortened labels.

## Start a fresh demo

From a repository checkout with Node 22.12 or newer:

```sh
npm ci --no-audit --no-fund
npm run demo
```

The command builds the app, makes a new board in an operating-system temporary folder, and prints an address on **127.0.0.1:5194**. Open the complete printed address, including its temporary token. If that port is busy, stop the other demo before starting another one.

The demo ignores `SHEPHERD_DATA_DIR` and `SHEPHERD_PROJECTS_DIR`. It never creates a runner, reads your agent settings, or uses your board. Run, Draft, checks, repository selection, and opening external apps are disabled. Editing the throwaway board is fine. Ctrl+C stops the server and removes its temporary board; starting again restores the example.

The board is created through the authenticated API. Simulated run results, statuses, progress marks, and check results use Shepherd's engine actions. The Apple Pay button step has a failed check followed by a successful retry; open its Output timeline to see both runs. The recovery and end-to-end steps stay running so screenshots do not depend on timing.

## Retake every image

When running inside Shepherd, use its screenshot helper. Leave `npm run demo` running in one terminal, then run this in another terminal with the **demo's** printed address:

```sh
node scripts/demo-screenshots.mjs 'http://127.0.0.1:5194/?token=TOKEN_FROM_DEMO'
```

`SHEPHERD_LOOK` must be set to the helper supplied by Shepherd. The script uses it for every capture, clicks through the views above, and copies each returned PNG into this directory immediately. It refuses captures with page errors or files above 500 KB. It only visits the demo address you give it. To retake one image, append its name without `.png`, for example `step-output-mobile`.

Without the helper, open the printed demo address in a browser and use the image list above as a capture guide. Set the viewport to the listed width and height. For the outline capture, open **Handle payment retries**, collapse **More options**, and return to the top of the panel. For Draft, choose **Track a delivery** in the switcher. Do not submit the draft or run a step.

After retaking, open **every** PNG. Check for personal data, browser or page errors, clipped featured content, and readable labels at both widths. Keep the PNGs below about 500 KB; the current images need no compression. Do not save a screenshot of the terminal or include the temporary token in documentation.

To verify the implementation:

```sh
npx tsc -b && npx vitest run && npm run build
```
