# Shepherd

A local tool for outlining a multi-step coding job, seeing it as a map, and having coding agents run it step by step.

You write the steps as an indented list, or describe the goal and let Codex draft them. Each step gets a prompt and someone to do it: Codex, Claude Code, or you. Press Run and Shepherd runs the steps in order with the real `codex` and `claude` CLIs. Each step starts from the work of the steps before it, merged into its own git branch, with their reports in its prompt. The map lights up as steps start and finish. Accepted work collects in the task's own branch and folder. When every step is done, you can merge the task into its base branch.

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

A project is a repository. Each project has tasks, and each task has its own goal, outline, steps and running flag. New projects start with one task named after the project. The project switcher groups open tasks under their project, with steps done, Running and Needs you indicators. Done and archived tasks are folded away under each project. New task asks for a name and goal, then opens the outline with that goal ready in the Codex Draft box, including Model and Thinking. The outline, map, counters, Agents and Activity follow the selected task. ⌘K (Ctrl+K elsewhere) searches tasks across projects and can start a new task. Switching tasks clears step filters and selection. Opening Activity marks only that task's notifications read.

The task header shows its branch, base and folder once created, and any wait for uncommitted changes. Copy path copies the folder; Cursor opens it with `cursor <folder>` on the Mac running Shepherd, and Finder opens it there. Install the `cursor` shell command from Cursor's Command Palette if it is missing. Task actions (the three dots) edits its name and goal, marks it done, archives it, reopens it, merges it into its recorded base, or deletes it. Done and Archive stop the plan. Merging asks before updating the project checkout and requires all steps accepted. Deleting asks first and removes the task and steps from the board, stopping agents; its branch, folder, step branches, files and commits stay on disk.

- **Write the outline.** The list on the left is the plan. Enter adds a step, Tab indents it, Shift+Tab outdents it, Alt+↑/↓ moves it, Backspace on an empty step deletes it, and the grip drags it. Pasting a bulleted or numbered list makes one step per line, keeping its indents. `N` adds a step from anywhere.
- **Draft from a goal.** Type what you want done and press Draft steps. Codex reads the project folder (read-only) and suggests steps, which land at the end of the outline for you to edit. Nothing runs until you press Run.
- **What runs when.** Steps run top to bottom. An indented step runs after the step it sits under, at the same time as the other steps indented under it. The next step at the left edge waits for all of them. The map draws exactly these arrows and lays itself out left to right.
- **The map.** Cmd (Ctrl elsewhere) with + or − zooms it, and Cmd+0 or F fits it to the screen.
- **Arrows by hand.** Drawing or removing an arrow on the map, or changing "Starts after" in a step, sets that step's arrows by hand. The outline stops moving them, and the step shows a small marker. "Follow the outline instead" undoes it.
- **A step.** Click a step to open it. The Step tab has who does it and the prompt. The Output tab shows a timeline above the agent's report, then the files it changed with their diff and a merge button for that step alone. The newest run is open; earlier runs are folded. Notes have their time, adjacent commands fold into a count, and screenshots appear as thumbnails. Open commands to see their first line (up to 200 characters) and the outcome the agent's stream reported. Runs, checks, changed files, merge waits and the final report are recorded in order. Gaps over ten minutes show their duration and times, without guessing why. It loads when opened and follows board activity while work runs. Steps from before timelines still show their report with a line saying they have no timeline. The Log tab lets you send the agent an instruction.
- **Models.** Under "Who does it", an agent step can pick its model and how hard it thinks. Left on Default, it uses whatever your Codex or Claude Code settings say, so changing those changes every step that did not pick. Codex's list comes from its own model cache, so new models show up as Codex learns of them. If your Codex settings name a model that list no longer offers, steps on Default use Codex's first current model instead, and the picker says so. "Draft steps from a goal" has its own Model and Thinking, remembered in this browser. A step that picked a model shows it on the map, and its Log says what each run used. Giving the step to the other agent clears the choice and starts a fresh conversation; the work on its branch stays.
- **Saved steps.** A step you want in other projects, such as checking the page in Chrome, can be saved: "Save for reuse" at the bottom of its Step tab, or on its menu on the map. It keeps who does it, the model, the prompt and More options, and can bring along the steps under it or side by side with it. "Add a saved step" under the outline, typing `/` in an empty step, the map menu's "Add a saved step after this…", or ⌘K adds a copy. The copy belongs to the selected task: changing it, or the saved step, leaves the other alone. A changed copy offers to save its changes back. A person's checklist is left out unless you keep it, so each task gets one written from its own earlier steps. Shepherd starts you with "Check it in Chrome", "Audit the code", "Check it yourself" and "Open a merge request"; "Manage saved steps" edits, renames and deletes them, and brings back the starters.
- **Run.** Run, at the bottom of the list, starts every step in the selected task that is not done as soon as the steps before it are done, up to four agents at once. It retries steps that failed or that you paused. Stop pauses that task's agents where they are. Other tasks keep their own running state. A step that fails holds up the steps after it until you retry it; the plan carries on from there.
- **Done.** A step is done when its agent finishes, or when you mark your own step done. If you add checks, it is done only when they pass.
- **Your steps.** When the steps before one of yours are accepted, your step uses the task's folder and branch, and shows the path. Try the result there. Anything you change in that folder is committed under your git name when you mark the step done. If earlier work changes after that, the folder is brought up to date and the step asks you again. "Found a problem? Send it back" reruns an earlier agent step with your note, and the folder picks up its fix.
- **Your checklist.** If your step says nothing beyond its name when its folder is first made, Codex reads the folder and the earlier steps' prompts, reports and known issues, and writes the checklist into it: how to start the work, then the checks tests miss, such as how it looks, real clicks, reloads and links, and a narrow window. "Draft it from the earlier steps' work" under the prompt asks again at any time. The draft waits on the step, even if you look elsewhere or reload, until you use or discard it.

- **Done when progress.** An agent step's map node shows how many Done when items its agent says it has met, such as "2 of 4", during and after a run. The Step tab lists the items with the agent's notes. Marks and withdrawals also appear in Output's timeline with their time. These are the agent's account; checks still decide whether the step is done. Editing or removing an item drops its mark; moving unchanged items keeps their marks. Repeated items are keyed separately by occurrence; changing their count clears their marks because which copy survived is ambiguous. A fresh agent conversation clears marks, while resuming a conversation keeps them. Steps without Done when items show no progress count or list.

  Agents get numbered items and `SHEPHERD_DONE`, a small script they run as `node "$SHEPHERD_DONE" 2 "Checked the page at 390px"` as soon as they confirm each item. `node "$SHEPHERD_DONE" 2 --undo` takes a mark back. Notes must be 1–500 characters. Shepherd sets `SHEPHERD_URL`, `SHEPHERD_TASK_ID`, `SHEPHERD_RUN_ID`, and `SHEPHERD_DONE_KEYS` for the script. The item snapshot keeps an old prompt from marking an edited item, and requests from stopped or superseded runs are refused.
- **Known issues.** A problem you decide not to fix now can be kept on the step it belongs to, from its Output tab, or with "keep it as a known issue" on your step. The step stays done, the steps after it are told about it in their prompts, and the plan and the map show how many are open. "Make it a step" adds a Codex step at the end of the outline whose prompt is the issue; the issue counts as fixed once that step is done.
- **What agents see.** Agents can look at the pages they build. A Codex step is told to use its own browser tool first, in a new tab of your Chrome, and otherwise to ask Shepherd for a screenshot: Shepherd opens the page in a headless Chrome outside the sandbox, at any width, after any clicks, typing and key presses, and hands back the PNG and any errors the page logged. Shepherd's screenshots appear in the Output timeline; the latest 12 also appear under "What it looked at". Images referenced by retained timeline entries stay available. What an agent sees in your Chrome stays in its own session.
- **Merge.** Accepted steps merge automatically into the task's branch in its folder. Tracked changes you have not committed there hold the merge back: both the step and task say to commit or stash them, and Shepherd tries again automatically. When every step is done, "Merge this task into <base>" explicitly brings the task branch into its recorded base in the project folder. The project must still have that base checked out, with no uncommitted tracked changes. A conflict stops the merge and leaves the checkout untouched. Nothing merges into the project checkout on its own.

Add the saved **Open a merge request** step at the end of a task. Codex determines whether the remote is GitLab or GitHub, follows the repository's conventions and skills, and opens or updates a request into the task's base. It writes the title and description from all preceding steps' reports and finishes with the full request URL. Shepherd keeps the reported GitLab or GitHub link on the task header, including after reload. Authentication for the push and the agent's MR tools must already be available.

### Optional checks

Under More options on the Step tab:

- **Check command**, such as `npm test`. It runs in the step's worktree after each run, with a 5 minute limit, and the step is done only when it exits 0. A failed check fails the step and its output goes into the next run's prompt. While the plan runs, a failed check is retried twice.
- **Ask me to review it.** The plan waits for you to accept the step's work, or send it back, before the steps after it start.
- **Push task branch before running.** For agent steps, Shepherd pushes the task branch to the remote its base branch tracks, or `origin` if it has no tracking remote (or tracks locally). It pushes only that branch, without forcing. A missing remote or failed push fails the step with git's message before the agent starts. The agent is told the remote, source branch and base; it may create or update a merge request with `glab`, `gh` or its own tools, and must not commit or push.
- **Judge independently.** The step sees the earlier steps' files, but not what those agents said about them. Use it for a final review or test step.
- **Background** and **Done when** lines, which go into the agent's prompt.

## How it works

- **The server runs the board.** The board lives in the Vite dev server, which saves it to `.shepherd/state.json` and streams it to every open tab. Runs, checks, and merges happen on the server, so they keep going with no tab open.
- **Projects.** Choose a new folder in the workspace, or a repository you already have anywhere on this Mac. The workspace is `.agent-sandbox/` unless you change it in Settings. New workspace folders keep a relative `directory` and become repositories on their first run. Existing repositories keep an absolute `repo` path; `~` is allowed when entering it. The dialog checks the path as you type and shows its checked-out branch. A repository already used by a project is refused, with that project's name.
- **Existing repositories.** The path must exist and be the top folder of a git repository with at least one commit. Shepherd checks this again before every run, check, draft or checklist. It never initializes or makes an initial commit in a supplied repository. Step work happens in separate worktrees on branches Shepherd creates; the project's checkout and existing branches stay untouched until you explicitly merge. A missing, nested or empty repository stops the operation with an error naming its path.
- **Branches and worktrees.** A task first needing a folder gets a free branch named `shepherd/<task-name>`, made from the project's checked-out branch. The task records that branch as its `base`, and keeps its `branch` and `folder` under `.shepherd/worktrees/`. A detached checkout must be put on a branch first. Each agent step starts from the task branch on a separate `shepherd-step/<step-name>` branch and worktree, so parallel steps cannot overwrite each other or collide with task branch names. A person's commits in the task folder reach later steps. Before a run, Shepherd also merges the branches of the steps it waits for into its branch. The step's diff still shows only its own changes. If those branches conflict, the run stops before the agent starts and names the files.
- **Prompts.** Agents get `SHEPHERD_TASK_BRANCH`, `SHEPHERD_TASK_FOLDER` and `SHEPHERD_TASK_BASE` in their environment, and the prompt names their task's branch. A run sends the step's name, prompt, background, "done when" lines, check command, your instructions, and for each step it waits for, what it did, which files it wrote, and its report. When the agent exits, Shepherd commits everything it changed to the step's branch, authored by the agent, and keeps its final message as the step's report.
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
- `POST /api/actions` applies edits, such as `{ "action": { "type": "addSteps", "goalId": "...", "after": null, "steps": [...] } }`. See `Action` in `src/model/types.ts`.
- `POST /api/commands` runs things: `{ "command": "runPlan" | "stopPlan" | "mergePlan", "goalId": "..." }`, or `{ "command": "run" | "stop" | "instruct" | "check" | "complete" | "merge" | "forward", "taskId": "..." }`. `{ "command": "sendBack", "taskId": "<your step>", "to": "<an earlier agent step>", "text": "..." }` reruns that agent with your note. `{ "command": "checklist", "taskId": "<your step>" }` has Codex suggest a checklist, which waits on the step as `checklist` until a `settleChecklist` edit uses or discards it. `merge` collects an accepted step into its task branch; `mergePlan` is the explicit request to merge the task branch into its recorded base. A goal reports any pending merge in `blocker`, its last explicit merge in `merged`, and the merge request link reported by a push-enabled step in `mergeRequestUrl`.
- `POST /api/draft` with `{ "goal": "<task id or name>" }`, and optionally `prompt`, `model` and `thinking`, returns `{ "steps": [{ "name", "prompt", "depth" }] }` from Codex without adding them. It uses the task's saved goal text unless `prompt` is supplied.
- `POST /api/look` with `{ "taskId": "...", "url": "http://localhost:8130/", "width": 390, "full": true, "steps": [{ "click": "#go" }, { "type": "e4" }, { "press": "Enter" }, { "wait": 300 }] }` screenshots a local page for that step and returns `{ "path", "view", "title", "url", "width", "height", "errors" }`. `GET /api/looks/<taskId>/<file>` serves it.
- `POST /api/progress` with `{ "taskId": "...", "run": 1, "item": 2, "key": "...", "met": true, "note": "Checked at 390px" }` records an agent's Done when mark. `run` is `SHEPHERD_RUN_ID`; `item` is the item's number in its prompt; `key` is that entry in the JSON array `SHEPHERD_DONE_KEYS` (content and duplicate occurrence). Use `met: false` to withdraw it. The key must still identify an unchanged item, even if its position moved. Returns `{ "ok": true }`, or 409 with `{ "error" }` for an invalid item, note or inactive run. Only an active agent run can mark items. Marks live on the step as `acceptanceMarks`, keyed by item, with `{ "note", "at" }`; their history stays in the timeline file. Tabs cannot write marks through `/api/actions`.
- Known issues are edits: `{ "type": "noteIssue", "id": "<step>", "text": "..." }`, `dropIssue` with an `issueId`, and `fixIssue` with an `issueId` and the new `task`.
- `POST /api/goals/<id>/open` with `{ "app": "cursor" }` or `{ "app": "finder" }` opens only that task's saved folder on the server Mac. It runs `cursor` or `open` with the path as a single argument, without a shell. A missing task/folder, unsupported app, or launch failure returns 409 with a plain error.
- `GET /api/goals` lists tasks as `{ "goals": [...] }`. `POST /api/goals` adds one: `{ "project": "<project id or name>", "name": "Fix timeout", "goal": "Keep checkout fast" }`. A task has status `open`, `done` or `archived`.
- `readNotifications` accepts an optional `goalId` to mark only that task's step notifications read. Omit it to mark all read.
- Task edits use `createGoal` with a `goal` object, `updateGoal` with an `id` and a `patch` of `name` and/or `goal`, and `finishGoal`, `archiveGoal`, `reopenGoal` or `deleteGoal` with an `id`. Deleting a task deletes its steps from the board.
- `GET /api/tasks` lists every project, its tasks as `goals`, and its steps, with ids, status, whether each is done, its branch, and what it waits for.
- `GET /api/tasks/<stepId>/timeline?after=<entryId>` returns `{ "entries": [...], "cursor": 42, "first": 1, "runs": [1, 25] }`. Omit `after` (or use 0) for all retained entries, then pass `cursor` to fetch only newer ones. Each entry has a monotonic `id`, its `run` id, an arrival time `at` in milliseconds and a `kind` with its data. `first` is the oldest retained id and `runs` lists retained run ids: discard cached entries below `first` or outside those runs. A missing step returns 404; an existing step without a timeline returns an empty list. Timeline data is never included in the board or its stream.
- `POST /api/projects` adds a project: `{ "name": "My app", "summary": "...", "repo": "/Users/me/projects/my-app" }`. `repo` is optional: omit it for a new workspace folder named after the project. Use `repo` instead of `directory`; it accepts an absolute path or `~/...`, checks the repository and stores its real absolute path. Project names and repository checkouts must be unique.
- `GET /api/projects/repo?path=<encoded path>` checks a repository without changing it. It returns `{ "repo": "<real absolute path>", "branch": "main" }`, or a 400 response with `{ "error": "..." }`. A detached checkout is shown as `detached at <commit>`.
- `POST /api/tasks` adds one step, or several with a `tasks` list:

```sh
curl -X POST http://localhost:5173/api/tasks -H 'content-type: application/json' -d '{
  "project": "Greeter",
  "goal": "<task id or name>",
  "tasks": [
    { "name": "Wave CLI", "objective": "Create wave.mjs ...", "checkCommand": "npm test", "agent": "codex" },
    { "name": "Try the wave", "runner": "human", "dependsOn": [{ "task": "Wave CLI", "gate": "verified" }] }
  ]
}'
```

- `goal` is a task's id or name; `project` optionally scopes the lookup to a repository. For adding steps, drafting or plan commands, a request naming only a project uses its only open task. If there are several open tasks, the error lists them and asks which to use; if there are none, add or reopen one. Plan commands use `goalId` and also accept the older `projectId` when there is only one open task.
- Each step needs a `name`. `objective` (the prompt) defaults to the name.
- Optional fields are `description`, `acceptance` (a list of "done when" lines), `checkCommand`, `runner` (`agent` or `human`), and `agent` (`codex` or `claude`, default `codex`).
- Agent steps also take `model` (such as `gpt-6-astra`, or `opus` for Claude Code; `GET /api/models` lists them with your defaults) and `thinking` (`low`, `medium`, `high`, `xhigh`, `max`, or `ultra` where the model offers it). Leave them out to use your defaults.
- Agent steps also take `review: true` to wait for your review, `independent: true` to keep earlier agents' reports out of their prompt, `pushBeforeRun: true` to have Shepherd push the task branch before the agent starts, and `autoRun: true` to start on their own once what they wait for is done, without running the whole plan.
- `dependsOn` lists steps by id or name, in the same task or earlier in the same request. Those steps keep these arrows; the outline does not move them. The gate is `verified` (done) by default, or `completed` (finished, before its checks).
- A bad request gets a 400 that says what is wrong.

`GET /api/saved-steps` returns `{ steps }`, your saved steps. `PUT /api/saved-steps` with `{ steps }` replaces them all and returns what it kept; entries it cannot add to a project, such as one with no steps, are left out.

## Where things are stored

- Saved steps are in `.shepherd/saved-steps.json`, apart from the board, so clearing the board keeps them. Each save keeps the one before as `saved-steps.json.bak`. A file Shepherd cannot read is moved aside, not overwritten.
- Boards saved before tasks are upgraded to schema 3: each project gets one open task named after it, holding its outline, running flag and steps. Step ids, worktree folders and git branches stay the same. A migrated task without its own branch gets one lazily when needed. Finished steps keep their original branches; accepted work is collected from those branches into the task folder. Before the server first writes the upgraded board, it keeps the exact old file beside it as `.shepherd/state.pre-tasks.json`.
- The board is in `.shepherd/state.json`. Worktrees are in `.shepherd/worktrees/`, check evidence in `.shepherd/evidence/`, screenshots in `.shepherd/looks/`. Each step's timeline is an append-only `.shepherd/timelines/<stepId>.jsonl` file, capped at about 1 MB by removing the oldest runs first. If one run alone exceeds the cap, its oldest entries are removed. Deleting a step (including deleting its task or resetting the board) deletes its timeline. Restarted Shepherd records interrupted runs as stopped. Branches live in each project's repository.
- Deleting a task or step, or clearing the board removes it from the board but leaves its branch, worktree, and files on disk. Remove a worktree with `git worktree remove <folder>` in the project folder.

## Limits

- Shepherd pushes only for agent steps with **Push task branch before running** on. An agent creates the merge request; Shepherd keeps the link it reports. Shepherd does not resolve merge conflicts.
- `npm run dev` is the only way to run Shepherd, because the server is part of the Vite dev server.
- Claude Code's models are a fixed list: Fable, Opus, Sonnet and Haiku. Drafting checklists always uses your Codex default.
- Saved steps belong to this Shepherd folder. A copy added to a project does not follow later changes to its saved step. A saved step whose model this machine does not offer gets your default model, and Shepherd says so.
