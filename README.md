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

- `codex` (Codex CLI). Check with `codex login status`. Drafting steps from a goal uses Codex. When the ChatGPT app is installed, Shepherd runs the app's own Codex instead of the one on your `PATH`: the two share one cached model list, and Codex offers its newest models only to newer versions, so mixing them makes your default model come and go. Set `SHEPHERD_CODEX` to the path of another `codex` to choose.
- `claude` (Claude Code). Check with `claude auth status`.

Settings (the gear) shows which ones Shepherd can use.

## Using it

- **Write the outline.** The list on the left is the plan. Enter adds a step, Tab indents it, Shift+Tab outdents it, Alt+↑/↓ moves it, Backspace on an empty step deletes it, and the grip drags it. Pasting a bulleted or numbered list makes one step per line, keeping its indents. `N` adds a step from anywhere.
- **Draft from a goal.** Type what you want done and press Draft steps. Codex reads the project folder (read-only) and suggests steps, which land at the end of the outline for you to edit. Nothing runs until you press Run.
- **What runs when.** Steps run top to bottom. An indented step runs after the step it sits under, at the same time as the other steps indented under it. The next step at the left edge waits for all of them. The map draws exactly these arrows and lays itself out left to right.
- **The map.** Cmd (Ctrl elsewhere) with + or − zooms it, and Cmd+0 or F fits it to the screen.
- **Arrows by hand.** Drawing or removing an arrow on the map, or changing "Starts after" in a step, sets that step's arrows by hand. The outline stops moving them, and the step shows a small marker. "Follow the outline instead" undoes it.
- **A step.** Click a step to open it. The Step tab has who does it and the prompt. The Output tab has the agent's report, the files it changed with their diff, and a merge button for that step alone. The Log tab lets you send the agent an instruction.
- **Models.** Under "Who does it", an agent step can pick its model and how hard it thinks. Left on Default, it uses whatever your Codex or Claude Code settings say, so changing those changes every step that did not pick. Codex's list comes from its own model cache, so new models show up as Codex learns of them. If your Codex settings name a model that list no longer offers, steps on Default use Codex's first current model instead, and the picker says so. "Draft steps from a goal" has its own Model and Thinking, remembered in this browser. A step that picked a model shows it on the map, and its Log says what each run used. Giving the step to the other agent clears the choice and starts a fresh conversation; the work on its branch stays.
- **Saved steps.** A step you want in other projects, such as checking the page in Chrome, can be saved: "Save for reuse" at the bottom of its Step tab, or on its menu on the map. It keeps who does it, the model, the prompt and More options, and can bring along the steps under it or side by side with it. "Add a saved step" under the outline, typing `/` in an empty step, the map menu's "Add a saved step after this…", or ⌘K adds a copy. The copy is that project's own: changing it, or the saved step, leaves the other alone. A changed copy offers to save its changes back. A person's checklist is left out unless you keep it, so each project gets one written from its own earlier steps. Shepherd starts you with "Check it in Chrome", "Audit the code" and "Check it yourself"; "Manage saved steps" edits, renames and deletes them, and brings back the starters.
- **Run.** Run, at the bottom of the list, starts every step that is not done as soon as the steps before it are done, up to four agents at once. It retries steps that failed or that you paused. Stop pauses the agents where they are. A step that fails holds up the steps after it until you retry it; the plan carries on from there.
- **Done.** A step is done when its agent finishes, or when you mark your own step done. If you add checks, it is done only when they pass.
- **Your steps.** When the steps before one of yours are done, Shepherd merges their work into a folder for it, on its own branch, and the step shows the path. Try the result there. Anything you change in that folder is committed under your git name when you mark the step done. If earlier work changes after that, the folder is brought up to date and the step asks you again. "Found a problem? Send it back" reruns an earlier agent step with your note, and the folder picks up its fix.
- **Your checklist.** If your step says nothing beyond its name when its folder is first made, Codex reads the folder and the earlier steps' prompts, reports and known issues, and writes the checklist into it: how to start the work, then the checks tests miss, such as how it looks, real clicks, reloads and links, and a narrow window. "Draft it from the earlier steps' work" under the prompt asks again at any time. The draft waits on the step, even if you look elsewhere or reload, until you use or discard it.
- **Known issues.** A problem you decide not to fix now can be kept on the step it belongs to, from its Output tab, or with "keep it as a known issue" on your step. The step stays done, the steps after it are told about it in their prompts, and the plan and the map show how many are open. "Make it a step" adds a Codex step at the end of the outline whose prompt is the issue; the issue counts as fixed once that step is done.
- **What agents see.** Agents can look at the pages they build. A Codex step is told to use its own browser tool first, in a new tab of your Chrome, and otherwise to ask Shepherd for a screenshot: Shepherd opens the page in a headless Chrome outside the sandbox, at any width, after any clicks, typing and key presses, and hands back the PNG and any errors the page logged. Shepherd's screenshots, the latest 12 for each step, are on its Output tab under "What it looked at"; what an agent sees in your Chrome stays in its own session.
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
- **Codex's sandbox.** Codex runs with network access, so it can install packages, and with npm's cache in the temp folder, the only place outside the worktree it can write. A browser cannot start inside the sandbox. An agent sees pages through `node "$SHEPHERD_LOOK" <url> [--width 390] [--full] [--click <selector>] [--type <text>] [--press Enter] [--wait <ms>]`, which asks Shepherd for the screenshot, or through Codex's own browser tool. Browser tests belong in a check command, which runs outside the sandbox.
- **Codex in your Chrome.** Codex's browser tool drives your real Chrome, through the ChatGPT extension, in tabs of its own that close when the run ends. Before it reads a site it asks "Allow Chrome to access …?", and nobody can answer that during a run, so a run gets only the sites you approved ahead of time. To approve every page on this machine, add this to `~/.codex/browser/config.toml`:

  ```toml
  [origins]
  allowed = ["http://localhost:*", "http://127.0.0.1:*"]
  ```

  This applies to every Codex session, not only Shepherd's, and the steps running at the same time share your one Chrome.
- **Screenshots.** Shepherd uses the Chrome, Chromium, Edge or Brave it finds installed, or the one `SHEPHERD_CHROME` points to, with a fresh profile each time, and only for pages on this machine. Claude Code's own Chrome tool is not turned on, so Claude steps use Shepherd's screenshots.

## API

Everything the UI does goes through these, so agents and scripts can use them too. They live on the dev server and run agents and shell commands on your machine, so keep it bound to localhost. Every POST needs `content-type: application/json`.

- `GET /api/state` returns the whole board. `GET /api/stream` streams it as server-sent events.
- `POST /api/actions` applies edits, such as `{ "action": { "type": "addSteps", "projectId": "...", "after": null, "steps": [...] } }`. See `Action` in `src/model/types.ts`.
- `POST /api/commands` runs things: `{ "command": "runPlan" | "stopPlan" | "mergePlan", "projectId": "..." }`, or `{ "command": "run" | "stop" | "instruct" | "check" | "complete" | "merge" | "forward", "taskId": "..." }`. `{ "command": "sendBack", "taskId": "<your step>", "to": "<an earlier agent step>", "text": "..." }` reruns that agent with your note. `{ "command": "checklist", "taskId": "<your step>" }` has Codex suggest a checklist, which waits on the step as `checklist` until a `settleChecklist` edit uses or discards it.
- `POST /api/draft` with `{ "projectId": "...", "goal": "..." }`, and optionally `model` and `thinking`, returns `{ "steps": [{ "name", "prompt", "depth" }] }` from Codex without adding them.
- `POST /api/look` with `{ "taskId": "...", "url": "http://localhost:8130/", "width": 390, "full": true, "steps": [{ "click": "#go" }, { "type": "e4" }, { "press": "Enter" }, { "wait": 300 }] }` screenshots a local page for that step and returns `{ "path", "view", "title", "url", "width", "height", "errors" }`. `GET /api/looks/<taskId>/<file>` serves it.
- Known issues are edits: `{ "type": "noteIssue", "id": "<step>", "text": "..." }`, `dropIssue` with an `issueId`, and `fixIssue` with an `issueId` and the new `task`.
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
- Agent steps also take `model` (such as `gpt-6-astra`, or `opus` for Claude Code; `GET /api/models` lists them with your defaults) and `thinking` (`low`, `medium`, `high`, `xhigh`, `max`, or `ultra` where the model offers it). Leave them out to use your defaults.
- Agent steps also take `review: true` to wait for your review, `independent: true` to keep earlier agents' reports out of their prompt, and `autoRun: true` to start on their own once what they wait for is done, without running the whole plan.
- `dependsOn` lists steps by id or name, in the project or earlier in the same request. Those steps keep these arrows; the outline does not move them. The gate is `verified` (done) by default, or `completed` (finished, before its checks).
- A bad request gets a 400 that says what is wrong.

`GET /api/saved-steps` returns `{ steps }`, your saved steps. `PUT /api/saved-steps` with `{ steps }` replaces them all and returns what it kept; entries it cannot add to a project, such as one with no steps, are left out.

## Where things are stored

- Saved steps are in `.shepherd/saved-steps.json`, apart from the board, so clearing the board keeps them. Each save keeps the one before as `saved-steps.json.bak`. A file Shepherd cannot read is moved aside, not overwritten.
- The board is in `.shepherd/state.json`. Worktrees are in `.shepherd/worktrees/`, check evidence in `.shepherd/evidence/`, screenshots in `.shepherd/looks/`. Branches live in each project's repository.
- Deleting a step or clearing the board removes it from the board but leaves its branch, worktree, and files on disk. Remove a worktree with `git worktree remove <folder>` in the project folder.

## Limits

- Shepherd does not push, open pull requests, or resolve merge conflicts. Merges happen locally.
- `npm run dev` is the only way to run Shepherd, because the server is part of the Vite dev server.
- Claude Code's models are a fixed list: Fable, Opus, Sonnet and Haiku. Drafting checklists always uses your Codex default.
- Saved steps belong to this Shepherd folder. A copy added to a project does not follow later changes to its saved step. A saved step whose model this machine does not offer gets your default model, and Shepherd says so.
