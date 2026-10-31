# Shepherd

A local board for handing tasks to coding agents and checking their work before anything downstream starts.

You lay out tasks on a canvas and connect them with dependencies. Shepherd runs each agent task with the real Claude Code or Codex CLI, shows what it is doing, and keeps the task unverified until its evidence holds up. A task is verified only when its check command exits 0 (if it has one) and you have accepted the result. An agent saying it is done does not count.

## Run it

```sh
npm install
npm run dev     # http://localhost:5173
npm test
```

You also need `git`, and at least one of these installed and logged in on the same machine:

- `claude` (Claude Code). Check with `claude auth status`.
- `codex` (Codex CLI). Check with `codex login status`.

The sidebar shows which ones Shepherd can use.

## How it works

- **Projects.** Each project is one git repository in a folder of the workspace. The workspace is `.agent-sandbox/` unless you change it in the sidebar. Point a project at an existing repository's folder to work on it. Any other folder becomes a new repository on its first run, with whatever was already in it as the first commit.
- **Branches and worktrees.** Each agent task gets its own branch, `shepherd/<task>`, checked out in its own worktree. Agents never share a folder, so tasks can run in parallel without touching each other's files.
- **Runs.** Run sends the task's objective, context, "done when" list, upstream outputs, and your instructions to the agent. Shepherd streams the agent's activity onto the card. When the agent exits, Shepherd commits everything it changed to the task's branch, authored by the agent, and records the diff.
- **Codex's sandbox.** Codex runs with network access, so it can install packages, and with npm's cache in the temp folder, the only place outside the worktree it can write. A browser cannot start inside the sandbox, so browser tests belong in the check command, which runs outside it.
- **Run automatically.** A task set to run automatically starts the first time every gate into it opens, as long as Shepherd is open in a browser. Retries stay manual.
- **Independent tasks.** An independent task sees what upstream tasks wrote, but not the upstream agents' summaries of it. Use it for tests, reviews, and audits that should judge the work, not the author's account of it.
- **Upstream work.** Before a run, Shepherd merges the branches of the tasks it depends on into the task's branch, so the agent starts from their work. The task's diff still shows only its own changes. If upstream branches conflict, the run stops before the agent starts and names the files.
- **Check commands.** A task can have a shell command, such as `npm test` or `node check.mjs`. It runs in the task's worktree after each successful agent run (or when you click Run check) with a 5 minute limit. If it exits 0, the check passes. Otherwise the task fails, and the output goes into the next run's prompt. For your own tasks it runs in the project folder.
- **Review.** Agent tasks also need you to accept them, unless they were added through the API with `"review": false`, in which case the check alone verifies them. The Verification tab shows the check output and the task's diff so you can decide.
- **Merge.** Once a task is verified, the Verification tab can merge its branch into the branch the project folder has checked out. Shepherd refuses if that folder has uncommitted changes or the merge conflicts, and leaves it untouched.
- **Gates.** Each dependency opens when the upstream task finishes, or only when it is verified (the default). A task behind a closed gate cannot start.
- **Decompose.** This turns a description into investigate, implement, and verify steps that you can edit before adding them to the board.

## Adding tasks from an agent or script

Agents and scripts can put projects and tasks on the board without the UI. Running, reviewing, and merging still happen in Shepherd.

`GET /api/tasks` lists every project and its tasks, with ids, status, whether each is verified, its branch, and what it depends on.

`POST /api/projects` adds a project: `{ "name": "Hello counter", "summary": "...", "directory": "hello-counter" }`. The folder is optional and defaults to one named after the project. Project names must be unique.

`POST /api/tasks` adds one task, or several with a `tasks` list:

```sh
curl -X POST http://localhost:5173/api/tasks -H 'content-type: application/json' -d '{
  "project": "Greeter",
  "tasks": [
    { "name": "Wave CLI", "objective": "Create wave.mjs ...", "checkCommand": "npm test", "agent": "codex" },
    { "name": "Try the wave", "runner": "human", "dependsOn": [{ "task": "Wave CLI", "gate": "verified" }] }
  ]
}'
```

- `project` is a project's id or name. Each task needs a `name`. `objective` defaults to the name.
- Optional fields are `description` (extra context for the agent), `acceptance` (a list of "done when" lines), `checkCommand`, `runner` (`agent` or `human`), and `agent` (`codex` or `claude`, default `codex`).
- Agent tasks also take `autoRun: true` to start on their own once their gates open, `independent: true` to keep upstream agents' summaries out of their prompt, and `review: false` to be verified by their check command alone.
- `dependsOn` lists tasks by id or name. A task can depend on tasks already in the project, or on earlier tasks in the same request. The gate defaults to `verified`.
- The response gives the new task ids. A bad request gets a 400 that says what is wrong.

When Shepherd is open in a browser, the server returns 202 and that tab adds the projects and tasks within a few seconds. The server waits for the tab because the tab saves the whole board on every change and would overwrite anything written in between. If no tab has checked in for 90 seconds, the server writes the tasks itself and returns 201.

## Where things are stored

- The board is saved in `.shepherd/state.json`, with rolling backups in `.shepherd/backups/`. Every open tab reads and writes the same file. Projects and tasks sent to the API wait in `.shepherd/inbox.json` until an open tab saves them.
- Worktrees live in `.shepherd/worktrees/`. Branches live in each project's repository.
- Clearing the workspace or deleting a task removes it from the board but leaves its branch, worktree, and files on disk. Remove a worktree with `git worktree remove <folder>` in the project folder.

## Limits

- Shepherd does not push, open pull requests, or resolve merge conflicts. Merges happen locally.
- The API lives in the Vite dev server, so `npm run dev` is the only way to run Shepherd. The API runs agents and shell commands on your machine. Keep it bound to localhost.
- The Codex model is set in `src/model/workspace.ts`. Claude Code uses its default model.
