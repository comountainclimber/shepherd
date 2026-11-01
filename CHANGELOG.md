# Changelog

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
