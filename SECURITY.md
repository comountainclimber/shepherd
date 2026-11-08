# Security

## Trust model

Shepherd runs on your machine. It starts the real Codex and Claude Code with
your logins, repositories, connectors and skills. Agents and check commands run
with your permissions, subject to the agent's own sandbox and configuration.
They can read or change files, execute commands and contact services you can
access. A git worktree separates changes; it is not a security sandbox. Only
run plans, prompts and repositories you trust, and review work before merging.

Shepherd has no accounts, hosted database or telemetry. Boards, saved steps,
reports, screenshots and worktrees stay in its configured local folders.
Agents, connectors, git remotes and commands you run can send data elsewhere
using your own configuration. Local reports and screenshots may contain
sensitive data from that work.

Both the standalone server and development server listen only on
`127.0.0.1`. Each start creates a random token. The printed address exchanges
that token for an HttpOnly, SameSite=Strict browser cookie. Opening any page
path with `?token=<token>` unlocks the browser and redirects to the same path,
removing the token from the address and keeping other query parameters. A wrong
token is refused. API paths do not accept query tokens; API clients and
agent helpers can use a bearer token. Every API route, including the event
stream, screenshots and reports, requires authentication. Requests with a
foreign Origin or Host are refused. Restarting the server invalidates the old
token. Static page assets alone do not grant API access.

Treat the token address like a password. An authenticated client can start
commands with your permissions. Do not expose Shepherd through a public proxy
or tunnel, bind it to a public interface, or share the token. Loopback and the
token do not protect against a compromised local account or an agent that has
already been granted access to your files and credentials.

## Report a vulnerability privately

Open the GitHub repository identified by `repository.url` in `package.json`.
Under **Security → Advisories**, choose **Report a vulnerability** to send a
private report to its maintainers. If that option is unavailable, use a private
contact method published on the repository owner's GitHub profile. Do not open
a public issue or pull request with exploit details, tokens or private logs.

Include the affected version, operating system and Node version, reproduction
steps with a disposable repository, the expected and observed behavior, and
the impact. Remove credentials and personal data from evidence. Please allow
time to investigate and coordinate a fix before disclosing details publicly.

Security fixes target the latest released version. Older versions do not have
a separate maintenance commitment; update to the latest release when a fix is
available.
