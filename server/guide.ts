export function guideText(origin: string): string {
  return `# Shepherd for outside agents

Shepherd is a local app for planning, running and checking coding-agent work.
It runs your agents in separate git worktrees and collects accepted work on a task branch.

## The words

A project is a repository. A task is one piece of work with its own branch.
A step is one agent's or person's job inside a task.
The API still calls a task a goal and a step a task.

## Authenticate

Read url and token from session.json in Shepherd's data folder while it is running.
The server origin for this guide is ${origin}; use the session token as $TOKEN below.
Every request needs \`Authorization: Bearer <token>\`. Keep the token private.
Replace <project id> and <task id> below with ids from the list and creation responses.
Every POST needs content-type: application/json; replace npm test with the repository's test command.

## Five calls

1. GET /api/tasks: see projects, their tasks, and steps.

\`\`\`sh
curl "${origin}/api/tasks" -H "Authorization: Bearer $TOKEN"
\`\`\`

2. POST /api/goals: add a task. The response's goal.id is its id.

\`\`\`sh
curl -X POST "${origin}/api/goals" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"project":"<project id>","name":"Add greeting","goal":"Provide a greeting module and CLI"}'
\`\`\`

3. POST /api/tasks: add steps. dependsOn names an existing step or an earlier one in this request; verified waits for its checks to pass.

\`\`\`sh
curl -X POST "${origin}/api/tasks" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{
  "goal":"<task id>",
  "tasks":[
    {"name":"Greeting module","objective":"Implement src/greet.ts and its tests","agent":"codex","acceptance":["The module returns a greeting for a supplied name"],"checkCommand":"npm test"},
    {"name":"Greeting CLI","objective":"Implement a CLI using the greeting module","agent":"codex","acceptance":["The CLI prints a greeting for the supplied name"],"checkCommand":"npm test","dependsOn":[{"task":"Greeting module","gate":"verified"}]},
    {"name":"Try greeting","runner":"human","objective":"Run the CLI and review its output","dependsOn":[{"task":"Greeting CLI","gate":"verified"}]}
  ]
}'
\`\`\`

4. POST /api/draft: have Codex suggest steps from the saved task objective. It returns steps without adding them; review and adapt them before posting to /api/tasks.

\`\`\`sh
curl -X POST "${origin}/api/draft" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"goal":"<task id>"}'
\`\`\`

5. POST /api/commands with runPlan: start the task.

\`\`\`sh
curl -X POST "${origin}/api/commands" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"command":"runPlan","goalId":"<task id>"}'
\`\`\`

## Make a good map

- Use three to eight steps with clear file boundaries.
- Steps run side by side only when they change different files; otherwise add dependsOn.
- Give every agent step Done when lines in acceptance, and a checkCommand when the repository has tests.
- End with a step for a person (runner: human) to close work someone has to look at.

See docs/api.md for everything else.
`;
}
