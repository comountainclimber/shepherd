# Contributing to Shepherd

Shepherd is a local app for planning, running and checking coding-agent work. It
uses your own tools and logins. Contributions should keep it useful without
accounts, a hosted database or telemetry.

## Set up

Clone the repository listed in `package.json`, then work in that checkout.
Use Node.js 22.12.0 or newer (the current LTS is recommended), npm and git.
macOS is supported first; Linux is supported where no Mac-only feature is needed.
Windows is not supported yet.

```sh
npm ci
npm run dev
```

Open the token address printed in the terminal. Development listens on
`127.0.0.1`, starting at port 5194, and stores its board in `.shepherd/` and new
repositories in `.agent-sandbox/`. Both folders are ignored by git. To keep
development data elsewhere, set `SHEPHERD_DATA_DIR` and
`SHEPHERD_PROJECTS_DIR` before starting the server.

To run real agent steps, install and sign in to Codex or Claude Code on the same
machine. Planning from a goal and checking work require Codex. The automated
tests use stand-in agents and temporary git repositories; they do not require
agent accounts. Screenshot integration tests use Chrome or Chromium when it is
available and skip those checks otherwise.

To try the installed app's server and launcher from the checkout:

```sh
npm run build
npm start -- --no-open
```

This uses the per-user data folder by default. For an isolated run, pass
`--data-dir` and `--projects-dir` with folders of your choice. See the README for
launcher options and storage details. Treat every running copy as able to run
commands with your permissions; use a disposable repository for experiments.

## Check your changes

Run the same checks as CI before opening a pull request:

```sh
npm run typecheck
npm test
npm run build
```

The equivalent full check is `npx tsc -b && npx vitest run && npm run build`.
Run a focused test while iterating, for example
`npx vitest run server/intake.test.ts`. Add regression coverage for changed
behavior. For UI changes, also try the actual page at a wide width and at 390px,
exercise the affected controls, and check reloads and console errors.

For packaging changes, run `npm pack --dry-run`. It builds the app first. The
package should contain the two launcher files in `bin/`, the built page in
`dist/`, the built server and agent helpers in `dist-server/`, and npm's required
metadata, README and license. Source, tests, local boards, worktrees and reports
must stay out of the package.

CI runs a clean install, type check, tests and build on macOS and Ubuntu with
Node's current LTS. Platform-specific behavior needs a plain fallback message.

## Repository style

- Use TypeScript with strict types, React function components and the existing
  Tailwind utilities. Match the surrounding file's formatting; there is no
  Prettier configuration. Existing TypeScript uses two spaces, double quotes
  and semicolons.
- Keep board changes in actions handled by `src/model/reducer.ts`. The server's
  `server/engine.ts` validates actions from the browser. Do not bypass that
  boundary or let browser actions claim runs or checks have passed.
- Keep server behavior in `server/`. Development and the standalone server
  share the API and authentication boundary; keep both working.
- Put Vitest tests beside the behavior they cover as `*.test.ts`. Use neutral
  fixtures and temporary folders. Tests must not depend on your accounts,
  personal repositories or existing Shepherd data.
- Write comments only for constraints the code cannot show. UI text should be
  plain, short and concrete, addressed to the person using the app.
- Use made-up examples. Never add personal names, real contact details, home
  folder paths, employer details, internal services, tokens or private logs.
  Public tool names needed to explain an integration are fine.
- Keep changes focused. Describe the problem, resulting behavior and checks in
  the pull request. Include screenshots when the UI changes and call out
  storage, command execution or authentication changes.

Use the issue templates for bugs and feature requests. Report vulnerabilities
privately as described in [SECURITY.md](SECURITY.md), and follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

Repository links are defined in `package.json`. Before publishing the project,
replace its `OWNER` placeholders with the GitHub owner and enable private
vulnerability reporting in the repository's security settings.
