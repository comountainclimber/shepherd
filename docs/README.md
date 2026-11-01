# Shepherd documentation

[← Back to the launch README](../README.md)

Start with [setup](setup.md), then [using Shepherd](usage.md). The full operational reference from the original README is preserved across these pages.

- [Setup](setup.md): quick start, global install, launcher flags, agent logins, platform requirements and development.
- [Settings and environment](configuration.md): storage precedence, agent selection, models and helper variables.
- [Using Shepherd](usage.md): projects and tasks, the outline and map, shortcuts, saved steps, timelines, Done when progress, human review, known issues and merge requests.
- [Optional checks](checks.md): command checks, Codex work checks, retries, review and push-before-run.
- [How runs work](runs.md): branches and worktrees, prompt context, commits, sandbox and browser access.
- [Local API](api.md): authentication, board actions, commands, projects, tasks, drafts, progress, screenshots and timeline pagination.
- [Storage](storage.md): files, schema migration, backups, retention and cleanup.
- [Limits](limits.md): supported boundaries and constraints.
- [Screenshots and safe demo](screenshots/README.md): sample-data disclosure, image descriptions and retaking captures.
- [Brand assets](brand/README.md): logos, mascot, colors, typography and asset licenses.

[Contributing](../CONTRIBUTING.md) · [Code of Conduct](../CODE_OF_CONDUCT.md) · [Security](../SECURITY.md) · [MIT license](../LICENSE)

## Check documentation links

From the repository root:

```sh
node docs/check-links.mjs
```

The script checks local Markdown links and fragments, HTML image sources and picture sources, SVG references and CSS asset URLs throughout `README.md` and `docs/`. It ignores fenced code examples. It makes no network requests and reports external destinations, such as the README's badges, separately; it cannot establish that a package or repository has been published.
