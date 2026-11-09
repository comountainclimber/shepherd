# Changelog

## 0.2.0

- Browse each repository's objectives and graphs in a sidebar tree, and open
  any graph's steps from it.
- Keep your place in the address bar: refresh, Back, Forward, pasted links and
  new tabs reopen the same task, step and tab.
- Let agents Shepherd did not launch find a running Shepherd through a private
  `session.json` in the data folder, and learn the API from `/api/guide`.
- Draft maps with side-by-side steps, Done when lines and check commands by
  default. `POST /api/goals` can draft a new task in one request, `POST
  /api/tasks` accepts `depth`, and responses describe the resulting map.
- Send a step whose merge conflicts back to its agent with the conflict left
  in its folder before asking a person.

Known issue: Shepherd only commits an agent's conflict resolution once the
resolved files are staged, so a conflicting step usually still ends up waiting
for you.

## 0.1.0

Initial open-source release.

- Run locally with `npx shepherd-agents` or the installed `shepherd` command.
- Plan work across projects and tasks, with a branch and folder for each task
  and separate worktrees for agent steps.
- Run Codex, Claude Code and human steps in dependency order, with saved steps,
  model choices, check commands and review gates.
- Follow run timelines, screenshots, reports, known issues and Done when
  progress; optionally check work against each step's request.
- Collect accepted work into the task branch, merge it explicitly into its
  base, and use a saved step to open a merge request.
- Serve the built app on loopback with per-start tokens and Origin checks.
- Store work locally without Shepherd accounts, hosted storage or telemetry.
- Add MIT licensing, contribution and security guidance, a code of conduct,
  issue and pull request templates, and CI on macOS and Ubuntu.
