# Project Memory MCP — Developer Manual

Project Memory MCP (`pmem`) is a shared memory layer for coding agents.

It exists to make agent work reproducible: the agent should know the current
project, active task, previous decisions, failed attempts, reusable rules, and
shared files before it starts changing code.

This is not a generic note-taking app. Store only knowledge that should affect
future work.

## What pmem Solves

Agents lose context between sessions. That causes repeated mistakes:

- the same failed approach is tried again
- architecture decisions are rediscovered from scratch
- project-specific rules are missed
- reusable templates are copied manually or drift between projects
- shared team knowledge stays inside one developer's local chat

`pmem` gives agents a structured place to ask:

- Which project am I working on?
- What task is next?
- What decisions constrain this task?
- What failed attempts should I avoid?
- Which common rules apply?
- Is there a reusable artifact, such as an `AGENTS.md` template, that I should
  download instead of inventing one?

## Mental Model

### Projects

Project-specific records belong to a project. Use them for repository facts,
tasks, decisions, local conventions, and implementation history.

### Common Knowledge

Common records are reusable across projects. Use common only for durable
cross-project knowledge:

- agent workflow rules
- implementation patterns
- review checklists
- reusable prompts
- coding conventions
- shared templates

Do not put one-off project facts into common.

### Tasks

Tasks describe work that an agent can execute. A good task includes scope,
acceptance criteria, allowed files, forbidden files, dependencies, and notes.

Agents should use `preflight` before implementation when a task exists.

### Decisions

Decisions are first-class records. Use them for architecture, workflow, or
product choices that should constrain later work.

Do not hide real decisions inside casual notes.

### Events

Events are append-only history: task started, task completed, migration applied,
failed attempt recorded, project created.

Do not rewrite event history casually.

### Artifacts

Artifacts are shared files stored on the gateway. They can be Markdown or binary
files.

Use artifacts for reusable files:

- `AGENTS.md` templates
- onboarding docs
- checklists
- generated documentation snapshots
- reusable config examples
- diagrams and binary assets when they are actually useful

Artifact metadata is stored in PostgreSQL. File bytes are stored on the gateway
filesystem under `ARTIFACT_DIR`.

## Shared Gateway Setup

Developers usually connect agents to the shared HTTP gateway.

Set the bearer token in the shell that starts the agent:

```bash
export PMEM_MCP_TOKEN="<gateway-token>"
```

Add the MCP server to Codex:

```bash
codex mcp add project-memory \
  --url "https://pmem.undoo.ru/api/mcp?client_id=${USER}@$(hostname -s)&client_label=${USER}@$(hostname -s)&client_kind=codex" \
  --bearer-token-env-var PMEM_MCP_TOKEN
```

Restart the agent after changing MCP configuration.

The `client_id` should be stable for the developer or machine. This makes
`gateway.clients` useful for collaboration and audit trails.

### Clients Without HTTP Header Support

Some MCP clients can connect to a remote Streamable HTTP URL but cannot send
custom HTTP headers. CodeWhale v0.8.x is one example: direct URL registration
works, but authenticated gateways return `401` because the bearer header is not
sent.

Use the packaged stdio bridge for these clients:

```bash
export PMEM_MCP_TOKEN="<gateway-token>"
export PMEM_MCP_URL="https://pmem.undoo.ru/api/mcp?client_id=codewhale:${USER}@$(hostname -s)&client_label=CodeWhale%20${USER}@$(hostname -s)&client_kind=codewhale"

project-memory-http-stdio-bridge
```

The MCP client should register it as a stdio server:

```json
{
  "servers": {
    "project-memory": {
      "command": "project-memory-http-stdio-bridge",
      "args": [],
      "env": {
        "PMEM_MCP_URL": "https://pmem.undoo.ru/api/mcp?client_id=codewhale:developer@host&client_label=CodeWhale%20developer@host&client_kind=codewhale",
        "PMEM_MCP_TOKEN": "<token or wrapper-provided env>"
      }
    }
  }
}
```

If the client does not expand environment placeholders, keep secrets out of MCP
JSON and use a local wrapper script that sources a private `.env`, exports
`PMEM_MCP_TOKEN`, and executes `project-memory-http-stdio-bridge`.

## First Smoke Test

After connecting an agent, ask:

```text
Расскажи, что такое project-memory / pmem, и как мне его использовать.
```

The agent should call `gateway.about`.

To receive the bundled Markdown manuals directly through MCP, ask:

```text
Дай мне manuals по pmem в Markdown: user/developer и agent.
```

Expected tool flow:

```text
gateway.about
gateway.manuals(audience="all", includeContent=true)
```

Then ask it to check the shared gateway:

```text
Проверь, что ты подключен к общему pmem gateway.
```

Expected tool flow:

```text
gateway.status
gateway.clients
```

The gateway should report:

- `mode: gateway`
- `storage: postgresql`
- available project-memory tools
- recent clients

If the agent only sees local SQLite state, it is not connected to the shared
gateway.

## How To Use pmem Safely

### Before Implementation

Ask the agent to check memory before non-trivial work:

```text
Перед началом проверь pmem: текущий проект, решения, похожие ошибки и preflight.
```

Expected flow:

```text
project.current
memory.search
decision.list
task.next or task.get
preflight
```

If preflight finds a conflict, the agent should stop and ask for clarification.

### During Work

The agent should work inside the task scope. If it discovers that the requested
change requires forbidden files, broader architecture changes, or a conflicting
decision, it should ask before continuing.

### After Work

Record only durable knowledge:

- use `event.record` for important history
- use `decision.record` for decisions that should constrain future work
- use `memory.create(type="failed_attempt")` when an approach failed and should
  not be repeated
- use `artifact.put` when a reusable file should be shared with the team

Do not record every tiny observation.

## Artifact Workflow

### Search Before Creating

Before creating a reusable file, ask the agent to search:

```text
Поищи общий шаблон AGENTS.md для фронтенда.
```

Expected tool:

```json
{
  "tool": "artifact.search",
  "input": {
    "query": "frontend AGENTS template",
    "includeCommon": true,
    "tags": ["agents"],
    "limit": 10
  }
}
```

If several templates match, the agent should ask which one to use.

### Download

Artifact search returns a `downloadPath`, for example:

```text
/artifacts/A-COMMON-001/download
```

Append it to `GW_ENDPOINT`:

```text
https://pmem.undoo.ru/api/artifacts/A-COMMON-001/download
```

Bearer auth is still required.

For small Markdown files, the agent may use `artifact.get` with content enabled.
For larger files or binary files, it should download the file from
`downloadPath`.

### Upload

Agents upload artifact bytes as base64:

```json
{
  "project": "project-memory-mcp",
  "path": "templates/frontend/AGENTS.md",
  "title": "Frontend AGENTS.md",
  "description": "Reusable frontend agent instructions.",
  "contentType": "text/markdown; charset=utf-8",
  "contentBase64": "IyBBR0VOVFMubWQK",
  "tags": ["agents", "frontend", "template"],
  "overwrite": false
}
```

For common artifacts, use:

```json
{
  "common": true,
  "path": "templates/frontend/AGENTS.md"
}
```

Use `overwrite: true` only when the replacement is intentional.

## Guardrails

Do not store secrets:

- API keys
- database passwords
- private SSH keys
- production tokens
- customer data

Do not use pmem as a raw log bucket:

- avoid huge build logs
- avoid raw terminal dumps unless summarized
- avoid temporary scratch notes

Do not use common as a dumping ground:

- project facts go into the project
- reusable rules go into common

Do not let the agent invent missing context:

- if project scope is ambiguous, ask it to clarify
- if multiple artifacts match, ask it to list candidates
- if a decision conflicts with the request, resolve the conflict explicitly

## Useful Developer Prompts

Start a repository:

```text
Проверь pmem, выбери текущий проект, найди связанные решения и сделай preflight.
```

Find reusable knowledge:

```text
Поищи в pmem common knowledge паттерны для TypeScript service/repository слоя.
```

Find reusable files:

```text
Поищи на pmem gateway общий AGENTS.md для frontend-проекта и предложи лучший вариант.
```

Record a decision:

```text
Запиши в pmem решение: gateway использует PostgreSQL и хранит artifact metadata в БД, а bytes на диске.
```

Record a failed attempt:

```text
Запиши failed attempt в pmem: что пробовали, почему не сработало, что не повторять.
```

## Operations Notes

Gateway runtime is configured through `.env`:

```text
BIND=127.0.0.1
PORT=7000
API_ENDPOINT=/api
GW_ENDPOINT=https://pmem.undoo.ru/api
MCP_TOKEN=...
ARTIFACT_DIR=./artifacts
LOG_LEVEL=info
LOG_DIR=./logs/
LOG_PRETTY=true
LOG_INCLUDE_TIME=true
```

Run migrations before starting or after deploys that add tables:

```bash
npm run db:pg:migrate
npm run db:pg:status
```

Start or reload the gateway with PM2:

```bash
npm run build
pm2 startOrReload ecosystem.config.cjs --env production
```

Back up both:

- PostgreSQL database
- `ARTIFACT_DIR`

The database contains artifact metadata. The artifact directory contains the
actual file bytes. Losing either side breaks artifact retrieval.

## Related Docs

- [MCP_TOOLS.md](MCP_TOOLS.md) describes every tool contract.
- [TOOL_WORKFLOWS.md](TOOL_WORKFLOWS.md) describes recommended tool chains.
- [AGENT_STATE_MACHINE.md](AGENT_STATE_MACHINE.md) defines autonomous agent
  states and clarification triggers.
- [COLLABORATION.md](COLLABORATION.md) explains shared team knowledge goals.
- [NGINX.md](NGINX.md) describes reverse proxy routing.
