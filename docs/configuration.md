[← Shepherd](../README.md) · [Documentation](README.md)

# Settings and environment

## Settings in the app

Open the gear to see which agents Shepherd can use and choose the workspace for new projects. An existing repository stays in the folder you selected. A workspace saved in Settings takes priority over the launcher's default new-project folder.

A step's **Who does it** selects Codex, Claude Code or you. Agent steps can select Model and Thinking. **Default** follows that agent's settings. Codex's available list comes from its model cache; a configured model no longer in the list falls back to its first current model, with an explanation in the picker. Claude Code offers a fixed Fable, Opus, Sonnet and Haiku list. Switching an agent clears the model choice and starts a fresh conversation, keeping its branch's work.

The Draft box has its own Model and Thinking, remembered in this browser. Checklist drafting and work checks use your Codex default. More options on a step controls checks, review, independent judging, push-before-run, background and Done when. See [using Shepherd](usage.md) and [optional checks](checks.md) for the exact rules.

## Launcher defaults

- `SHEPHERD_DATA_DIR` changes the data folder. Installed default: `~/.shepherd/`. Development default: the checkout's `.shepherd/`.
- `SHEPHERD_PROJECTS_DIR` changes the default folder for new repositories. Installed default: `projects/` inside the data folder. Development default: the checkout's `.agent-sandbox/`.
- `--data-dir` and `--projects-dir` override their corresponding environment defaults. The app's saved workspace takes priority for new projects. Existing repository paths are unaffected.
- `--port` chooses the first loopback port to try; `--no-open` leaves opening the printed token address to you. [All startup details and commands](setup.md).

## Agent and browser overrides

- `SHEPHERD_CODEX` selects a Codex executable path. Otherwise Shepherd prefers the macOS ChatGPT app's bundled Codex, then `codex` on `PATH`. This avoids mixing versions against a shared model cache.
- `SHEPHERD_CHROME` selects the browser executable used for Shepherd screenshots. Otherwise Shepherd looks for an installed Chrome, Chromium, Edge or Brave. Screenshots use a fresh profile and local pages only.

Agent credentials, connectors, skills and default models come from your own agent installations. Shepherd does not create a new provider account. Check logins with `codex login status` or `claude auth status`.

## Variables supplied to runs

These are context supplied by Shepherd, not values to invent in your shell:

- `SHEPHERD_TASK_BRANCH`, `SHEPHERD_TASK_FOLDER`, `SHEPHERD_TASK_BASE`: the task branch, folder and recorded base.
- `SHEPHERD_URL`, `SHEPHERD_TOKEN`: the local server and bearer token used by agent helpers. Keep the token private.
- `SHEPHERD_TASK_ID`: the running **step's** id. API field names retain the older task/goal naming; the UI calls these steps and tasks.
- `SHEPHERD_LOOK`: the Node helper for local-page screenshots. [Browser access and usage](runs.md).
- `SHEPHERD_DONE`, `SHEPHERD_RUN_ID`, `SHEPHERD_DONE_KEYS`: the Done when helper, active run id and JSON item-key snapshot. [Progress marking rules](usage.md#done-when-progress) and [API validation](api.md).
- `SHEPHERD_GATE`: the gate script supplied to agents and check commands. An agent's practice invocation does not count as Shepherd's check.

Command checks also receive `SHEPHERD_EVIDENCE_DIR` for evidence, `SHEPHERD_TASK` for the step name and, when the step has git state, `SHEPHERD_BRANCH` and `SHEPHERD_BASE_REF` for its branch and saved starting reference. Checks run outside the agent's sandbox. [Check behavior](checks.md) · [Trust model](../SECURITY.md)
