[← Shepherd](../README.md) · [Documentation](README.md)

# Local API

Everything the UI does goes through these, so agents and scripts can use them too. They live on the local server and run agents and shell commands on your machine. Every API request, including streams, screenshots and reports, needs the startup token: the browser uses an HTTP-only, SameSite cookie set by the printed address; scripts send `Authorization: Bearer <token>`. A supplied Origin must exactly match the printed address's origin, and requests to other hostnames are refused. Every POST and PUT needs `content-type: application/json`. Shepherd gives agents `SHEPHERD_TOKEN` along with `SHEPHERD_URL`, so `SHEPHERD_LOOK` and `SHEPHERD_DONE` authenticate automatically. There are no accounts, hosted database or telemetry; your agents, connectors, commands and git remotes may contact services using your own configuration.

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
- `POST /api/projects` adds a project: `{ "name": "My app", "summary": "...", "repo": "~/projects/my-app" }`. `repo` is optional: omit it for a new workspace folder named after the project. Use `repo` instead of `directory`; it accepts an absolute path or `~/...`, checks the repository and stores its real absolute path. Project names and repository checkouts must be unique.
- `GET /api/projects/repo?path=<encoded path>` checks a repository without changing it. It returns `{ "repo": "<real absolute path>", "branch": "main" }`, or a 400 response with `{ "error": "..." }`. A detached checkout is shown as `detached at <commit>`.
- `POST /api/tasks` adds one step, or several with a `tasks` list:

```sh
curl -X POST "$SHEPHERD_URL/api/tasks" -H "Authorization: Bearer $SHEPHERD_TOKEN" -H 'content-type: application/json' -d '{
  "project": "Greeter",
  "goal": "<task id or name>",
  "tasks": [
    { "name": "Wave CLI", "objective": "Create wave.mjs ...", "checkCommand": "npm test", "agent": "codex", "depth": 0 },
    { "name": "Test the wave", "objective": "Test the CLI ...", "depth": 1 },
    { "name": "Try the wave", "runner": "human", "depth": 1 },
    { "name": "Finish", "depth": 0 }
  ]
}'
```

- `goal` is a task's id or name; `project` optionally scopes the lookup to a repository. For adding steps, drafting or plan commands, a request naming only a project uses its only open task. If there are several open tasks, the error lists them and asks which to use; if there are none, add or reopen one. Plan commands use `goalId` and also accept the older `projectId` when there is only one open task.
- Each step needs a `name`. `objective` (the prompt) defaults to the name.
- `depth` is an optional integer from 0 to 2, defaulting to 0. Steps without `dependsOn` append to the end of the task's outline, with the same arrows as steps typed in the app. An indented step waits for the step above it at a shallower depth and runs alongside its siblings; the next step at depth 0 waits for the ends of the whole block above it. The first step stays at depth 0, and depth can increase by at most one from the previous step. These outline rules also apply to the single-step form.
- Optional fields are `description`, `acceptance` (a list of "done when" lines), `checkCommand`, `runner` (`agent` or `human`), and `agent` (`codex` or `claude`, default `codex`).
- Agent steps also take `model` (`GET /api/models` lists the choices with your defaults, including `opus` for Claude Code) and `thinking` (`low`, `medium`, `high`, `xhigh`, `max`, or `ultra` where the model offers it). Leave them out to use your defaults.
- Agent steps also take `workCheck: true` for the optional Codex work check (default `false`), `review: true` to wait for your review, `independent: true` to keep earlier agents' reports out of their prompt, `pushBeforeRun: true` to have Shepherd push the task branch before the agent starts, and `autoRun: true` to start on their own once what they wait for is done, without running the whole plan.
- `dependsOn` lists steps by id or name, in the same task or earlier in the same request, for arrows the outline cannot express. For example, `"dependsOn": [{ "task": "Wave CLI", "gate": "completed" }]`. Those steps keep these arrows; the outline does not move them. An empty list keeps a step unconnected. The gate is `verified` (done) by default, or `completed` (finished, before its checks). Supplying both `depth` and `dependsOn` gets a 400 asking you to pick one.
- A bad request gets a 400 that says what is wrong.

A successful `POST /api/tasks` returns 201 with `project`, `goal`, `tasks` (the newly added ids and names), and `steps` (every step in that task, in run order). Each entry in `steps` has `id`, `name`, `depth`, `runner` and `dependsOn`, a list of `{ "task": "<step id>", "gate": "verified" | "completed" }`. Steps that can run together keep their outline order. The dependencies show the actual arrows, including hand-drawn ones.

When the whole map has one step, or is a straight line of four or more steps with nothing side by side, the response also includes a plain `note`: steps that touch different files can run side by side, and a person's step can close the task. This is advice; the steps are still added. Branched maps and lines of two or three steps have no note.

`GET /api/saved-steps` returns `{ steps }`, your saved steps. `PUT /api/saved-steps` with `{ steps }` replaces them all and returns what it kept; entries it cannot add to a project, such as one with no steps, are left out.
