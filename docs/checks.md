[← Shepherd](../README.md) · [Documentation](README.md)

# Optional checks

Under More options on the Step tab:

- **Check command**, such as `npm test`. It runs in the step's worktree after each run, with a 5 minute limit, and the step is done only when it exits 0. A failed check fails the step and its output goes into the next run's prompt. While the plan runs, a failed check is retried twice.
- **Check the work against this step.** Off by default and kept in saved steps. Each check is another Codex run, fresh, read-only and in the step's folder, using your Codex default. It runs after the agent finishes and the command check passes (or straight after the agent if there is no command). It reads the goal, context, Done when items, later instructions and the diff from where the step started. Each item gets “met”, “not met” or “can't tell” with a reason. An unmet item or work against an explicit instruction fails the check; “can't tell” and changes not asked for are shown but do not fail it alone. Checks shows the verdicts, Output keeps them in the timeline, and Step puts them next to the agent's own marks. Failures go back to the agent with the verdicts, sharing the command check's two automatic retries while the plan runs; after that the step waits for you. Editing the step's request or bringing in upstream work invalidates the verdict.
- **Ask me to review it.** The plan waits for you to accept the step's work, or send it back, before the steps after it start.
- **Push task branch before running.** For agent steps, Shepherd pushes the task branch to the remote its base branch tracks, or `origin` if it has no tracking remote (or tracks locally). It pushes only that branch, without forcing. A missing remote or failed push fails the step with git's message before the agent starts. The agent is told the remote, source branch and base; it may create or update a merge request with `glab`, `gh` or its own tools, and must not commit or push.
- **Judge independently.** The step sees the earlier steps' files, but not what those agents said about them. Use it for a final review or test step.
- **Background** and **Done when** lines, which go into the agent's prompt.

[Done when progress](usage.md#done-when-progress) · [Run lifecycle](runs.md)
