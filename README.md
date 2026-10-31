# Shepherd

A local tool for outlining a multi-step coding job, seeing it as a map, and having coding agents run it step by step.

You write the steps as an indented list, or describe the goal and let Codex draft them. Each step gets a prompt and someone to do it: Codex, Claude Code, or you. Press Run and Shepherd runs the steps in order with the real `codex` and `claude` CLIs. Each step starts from the work of the steps before it, merged into its own git branch, with their reports in its prompt. The map lights up as steps start and finish. When every step is done, one button merges the result.

## Run it

```sh
npm install
npm run dev     # http://localhost:5173
npm test
```

You also need `git`, and at least one of these installed and logged in on the same machine:

- `codex` (Codex CLI). Check with `codex login status`. Drafting steps from a goal uses Codex.
- `claude` (Claude Code). Check with `claude auth status`.

Settings (the gear) shows which ones Shepherd can use.

## Using it

- **Write the outline.** The list on the left is the plan. Enter adds a step, Tab indents it, Shift+Tab outdents it, Alt+↑/↓ moves it, Backspace on an empty step deletes it, and the grip drags it. Pasting a bulleted or numbered list makes one step per line, keeping its indents. `N` adds a step from anywhere.
- **Draft from a goal.** Type what you want done and press Draft steps. Codex reads the project folder (read-only) and suggests steps, which land at the end of the outline for you to edit. Nothing runs until you press Run.
- **What runs when.** Steps run top to bottom. An indented step runs after the step it sits under, at the same time as the other steps indented under it. The next step at the left edge waits for all of them. The map draws exactly these arrows and lays itself out left to right.
- **Arrows by hand.** Drawing or removing an arrow on the map, or changing "Starts after" in a step, sets that step's arrows by hand. The outline stops moving them, and the step shows a small marker. "Follow the outline instead" undoes it.
- **A step.** Click a step to open it. The Step tab has who does it and the prompt. The Output tab has the agent's report, the files it changed with their diff, and a merge button for that step alone. The Log tab lets you send the agent an instruction.
- **Run.** Run, at the bottom of the list, starts every step that is not done as soon as the steps before it are done, up to four agents at once. It retries steps that failed or that you paused. Stop pauses the agents where they are. A step that fails holds up the steps after it until you retry it; the plan carries on from there.
- **Done.** A step is done when its agent finishes, or when you mark your own step done. If you add checks, it is done only when they pass.
- **Merge.** When every step is done, "Merge the result" brings the work into the branch the project folder has checked out. The last steps' branches already hold the earlier steps' work. Shepherd refuses if that folder has uncommitted changes or the merge conflicts, and leaves it untouched.

### Optional checks

Under More options on the Step tab:

- **Check command**, such as `npm test`. It runs in the step's worktree after each run, with a 5 minute limit, and the step is done only when it exits 0. A failed check fails the step and its output goes into the next run's prompt. While the plan runs, a failed check is retried twice.
- **Ask me to review it.** The plan waits for you to accept the step's work, or send it back, before the steps after it start.
- **Judge independently.** The step sees the earlier steps' files, but not what those agents said about them. Use it for a final review or test step.
- **Background** and **Done when** lines, which go into the agent's prompt.

## How it works

- **The server runs the board.** The board lives in the Vite dev server, which saves it to `.shepherd/state.json` and streams it to every open tab. Runs, checks, and merges happen on the server, so they keep going with no tab open.
- **Projects.** Each project is one git repository in a folder of the workspace. The workspace is `.agent-sandbox/` unless you change it in Settings. Point a project at an existing repository's folder to work on it. Any other folder becomes a new repository on its first run, with whatever was already in it as the first commit.
- **Branches and worktrees.** Each agent step gets its own branch, `shepherd/<step-name>`, checked out in its own worktree, so steps running side by side never touch each other's files. Before a run, Shepherd merges the branches of the steps it waits for into its branch. The step's diff still shows only its own changes. If those branches conflict, the run stops before the agent starts and names the files.
- **Prompts.** A run sends the step's name, prompt, background, "done when" lines, check command, your instructions, and for each step it waits for, what it did, which files it wrote, and its report. When the agent exits, Shepherd commits everything it changed to the step's branch, authored by the agent, and keeps its final message as the step's report.
- **Codex's sandbox.** Codex runs with network access, so it can install packages, and with npm's cache in the temp folder, the only place outside the worktree it can write. A browser cannot start inside the sandbox, so browser tests belong in a check command, which runs outside it.

## API

Everything the UI does goes through these, so agents and scripts can use them too. They live on the dev server and run agents and shell commands on your machine, so keep it bound to localhost. Every POST needs `content-type: application/json`.

- `GET /api/state` returns the whole board. `GET /api/stream` streams it as server-sent events.
- `POST /api/actions` applies edits, such as `{ "action": { "type": "addSteps", "projectId": "...", "after": null, "steps": [...] } }`. See `Action` in `src/model/types.ts`.
- `POST /api/commands` runs things: `{ "command": "runPlan" | "stopPlan" | "mergePlan", "projectId": "..." }`, or `{ "command": "run" | "stop" | "instruct" | "check" | "complete" | "merge" | "forward", "taskId": "..." }`.
- `POST /api/draft` with `{ "projectId": "...", "goal": "..." }` returns `{ "steps": [{ "name", "prompt", "depth" }] }` from Codex without adding them.
- `GET /api/tasks` lists every project and its steps, with ids, status, whether each is done, its branch, and what it waits for.
- `POST /api/projects` adds a project: `{ "name": "Hello counter", "summary": "...", "directory": "hello-counter" }`. The folder is optional and defaults to one named after the project. Project names must be unique.
- `POST /api/tasks` adds one step, or several with a `tasks` list:

```sh
curl -X POST http://localhost:5173/api/tasks -H 'content-type: application/json' -d '{
  "project": "Greeter",
  "tasks": [
    { "name": "Wave CLI", "objective": "Create wave.mjs ...", "checkCommand": "npm test", "agent": "codex" },
    { "name": "Try the wave", "runner": "human", "dependsOn": [{ "task": "Wave CLI", "gate": "verified" }] }
  ]
}'
```

- `project` is a project's id or name. Each step needs a `name`. `objective` (the prompt) defaults to the name.
- Optional fields are `description`, `acceptance` (a list of "done when" lines), `checkCommand`, `runner` (`agent` or `human`), and `agent` (`codex` or `claude`, default `codex`).
- Agent steps also take `review: true` to wait for your review, `independent: true` to keep earlier agents' reports out of their prompt, and `autoRun: true` to start on their own once what they wait for is done, without running the whole plan.
- `dependsOn` lists steps by id or name, in the project or earlier in the same request. Those steps keep these arrows; the outline does not move them. The gate is `verified` (done) by default, or `completed` (finished, before its checks).
- A bad request gets a 400 that says what is wrong.

## Where things are stored

- The board is in `.shepherd/state.json`. Worktrees are in `.shepherd/worktrees/`, check evidence in `.shepherd/evidence/`. Branches live in each project's repository.
- Deleting a step or clearing the board removes it from the board but leaves its branch, worktree, and files on disk. Remove a worktree with `git worktree remove <folder>` in the project folder.

## Limits

- Shepherd does not push, open pull requests, or resolve merge conflicts. Merges happen locally.
- `npm run dev` is the only way to run Shepherd, because the server is part of the Vite dev server.
- The Codex model is set in `src/model/workspace.ts`. Claude Code uses its default model.
