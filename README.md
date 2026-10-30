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
- **Upstream work.** Before a run, Shepherd merges the branches of the tasks it depends on into the task's branch, so the agent starts from their work. The task's diff still shows only its own changes. If upstream branches conflict, the run stops before the agent starts and names the files.
- **Check commands.** A task can have a shell command, such as `npm test` or `node check.mjs`. It runs in the task's worktree after each successful agent run (or when you click Run check) with a 120 second limit. If it exits 0, the check passes. Otherwise the task fails, and the output goes into the next run's prompt. For your own tasks it runs in the project folder.
- **Review.** Agent tasks also need you to accept them. The Verification tab shows the check output and the task's diff so you can decide.
- **Merge.** Once a task is verified, the Verification tab can merge its branch into the branch the project folder has checked out. Shepherd refuses if that folder has uncommitted changes or the merge conflicts, and leaves it untouched.
- **Gates.** Each dependency opens when the upstream task finishes, or only when it is verified (the default). A task behind a closed gate cannot start.
- **Decompose.** This turns a description into investigate, implement, and verify steps that you can edit before adding them to the board.

## Where things are stored

- The board is saved in `.shepherd/state.json`, with rolling backups in `.shepherd/backups/`. Every open tab reads and writes the same file.
- Worktrees live in `.shepherd/worktrees/`. Branches live in each project's repository.
- Clearing the workspace or deleting a task removes it from the board but leaves its branch, worktree, and files on disk. Remove a worktree with `git worktree remove <folder>` in the project folder.

## Limits

- Shepherd does not push, open pull requests, or resolve merge conflicts. Merges happen locally.
- The API lives in the Vite dev server, so `npm run dev` is the only way to run Shepherd. The API runs agents and shell commands on your machine. Keep it bound to localhost.
- The Codex model is set in `src/model/workspace.ts`. Claude Code uses its default model.
