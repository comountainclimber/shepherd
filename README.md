# Shepherd

A local board for handing tasks to coding agents and checking their work before anything downstream starts.

You lay out tasks on a canvas and connect them with dependencies. Shepherd runs each agent task with the real Claude Code or Codex CLI, shows what it is doing, and keeps the task unverified until its evidence holds up. A task is verified only when its check command exits 0 (if it has one) and you have accepted the result. An agent saying it is done does not count.

## Run it

```sh
npm install
npm run dev     # http://localhost:5173
npm test
```

You need at least one of these installed and logged in on the same machine:

- `claude` (Claude Code). Check with `claude auth status`.
- `codex` (Codex CLI). Check with `codex login status`.

The sidebar shows which ones Shepherd can use.

## How it works

- **Projects and folders.** Each project gets a folder in the workspace, which is `.agent-sandbox/` unless you change it in the sidebar. Each task gets a subfolder in its project, and the agent is told to work there. Every run starts its own CLI process in the project folder, so tasks can run in parallel.
- **Runs.** Run sends the task's objective, context, "done when" list, upstream outputs, and your instructions to the agent. Shepherd streams the agent's activity onto the card, and when the process exits it records which files changed and keeps a text preview of each.
- **Check commands.** A task can have a shell command, such as `npm test` or `node slugify/check.mjs`. It runs in the project folder after each successful agent run (or when you click Run check) with a 120 second limit. If it exits 0, the check passes. Otherwise the task fails, and the output goes into the next run's prompt.
- **Review.** Agent tasks also need you to accept them. The Verification tab shows the check output and the changed files so you can decide.
- **Gates.** Each dependency opens when the upstream task finishes, or only when it is verified (the default). A task behind a closed gate cannot start.
- **Decompose.** This turns a description into investigate, implement, and verify steps that you can edit before adding them to the board.

## Where things are stored

- The board is saved in `.shepherd/state.json`, with rolling backups in `.shepherd/backups/`. Every open tab reads and writes the same file.
- Agent output lands in the workspace folder. Clearing the workspace in Shepherd removes projects and tasks from the board but leaves files on disk.

## Limits

- Tasks in a project share one folder. There are no git worktrees or branches yet, so nothing stops two agents from editing the same file. When runs overlap, Shepherd credits each task only with the changes inside its own subfolder.
- The API lives in the Vite dev server, so `npm run dev` is the only way to run Shepherd. The API runs agents and shell commands on your machine. Keep it bound to localhost.
- The Codex model is set in `src/model/workspace.ts`. Claude Code uses its default model.
