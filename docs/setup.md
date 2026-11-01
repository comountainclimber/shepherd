[← Shepherd](../README.md) · [Documentation](README.md)

# Setup

Install Node.js 22.12 or newer, then run:

```sh
npx shepherd-agents
```

Shepherd starts on `127.0.0.1:5194`, tries the next port if it is busy, prints an address with a random token, and opens it in your browser. Keep the terminal running; Ctrl+C stops it. Open the printed address to unlock each new browser. A restart makes a new token. Keep that address private: Shepherd can run shell commands as you.

To install the command once:

```sh
npm install -g shepherd-agents
shepherd
```

Options work with either command:

```sh
shepherd --port 5200 --no-open
shepherd --data-dir ~/shepherd-data --projects-dir ~/projects
```

`--port` is the first port to try. `--no-open` leaves opening the browser to you. The board, saved steps, worktrees, screenshots and reports live in `~/.shepherd/`; new project repositories live in `~/.shepherd/projects/`. `--data-dir` changes the data folder and its default `projects/` subfolder. `--projects-dir` chooses the new-project folder separately. `SHEPHERD_DATA_DIR` and `SHEPHERD_PROJECTS_DIR` set the same defaults; command flags take priority. A workspace saved in Settings takes priority over the new-project default. Existing repository projects stay in the folders you selected. Installed runs never default to storing your work inside the npm package or the directory you launched from.

macOS is supported first. Linux should work wherever no Mac-only feature is needed, with the Codex and Claude Code CLIs and an installed Chrome or Chromium for screenshots. Opening Finder or Cursor from Shepherd is macOS-only; elsewhere, copy the task folder path and open it yourself. The ChatGPT app's bundled Codex is macOS-only; on Linux install the Codex CLI. Windows is not supported yet.

From a source checkout:

```sh
npm ci
npm run build
npm start                  # same launcher and per-user folders
npm run dev                # Vite, using the printed token address
npm test
```

Development binds to `127.0.0.1` and also starts at port 5194. It keeps the board in this checkout's `.shepherd/` and new projects in `.agent-sandbox/`, as before. The two folder environment variables also work in development. Authentication and Origin checks are the same in development and in the built app. `npm run build` builds both the page and the standalone Node server; `npm pack` includes those builds and the `shepherd` command.

You also need `git`, and at least one of these installed and logged in on the same machine:

- `codex` (Codex CLI). Check with `codex login status`. Drafting steps from a goal uses Codex. When the ChatGPT app is installed, Shepherd runs the app's own Codex instead of the one on your `PATH`: the two share one cached model list, and Codex offers its newest models only to newer versions, so mixing them makes your default model come and go. Set `SHEPHERD_CODEX` to the path of another `codex` to choose.
- `claude` (Claude Code). Check with `claude auth status`.

Settings (the gear) shows which ones Shepherd can use.


[Settings and environment variables](configuration.md) · [Trust model](../SECURITY.md) · [Storage](storage.md)
