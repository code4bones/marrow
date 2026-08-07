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

The gateway is intended for trusted internal company use. Authorization is a
shared bearer token: any client with the configured token can use the gateway.
Per-user roles, ACLs, and project permissions are not part of the current
product stage.

Set the bearer token in the shell that starts the agent:

```bash
export PMEM_MCP_TOKEN="<gateway-token>"
```

Add the MCP server to Codex:

```bash
codex mcp add project-memory \
  --url "https://marrow.example.com/api/mcp?client_id=${USER}@$(hostname -s)&client_label=${USER}@$(hostname -s)&client_kind=codex" \
  --bearer-token-env-var PMEM_MCP_TOKEN
```

Restart the agent after changing MCP configuration.

The `client_id` should be stable for the developer or machine. This makes
`gateway.clients` useful for collaboration and audit trails. Gateway current
project state is also scoped to this client id, so avoid random client ids.
If a gateway request omits `client_id`, pmem assigns a temporary anonymous
client id for that request. This prevents shared anonymous state, but it also
means implicit current project state is not durable.
Temporary anonymous client records are cleaned up after
`GATEWAY_ANONYMOUS_CLIENT_TTL_SECONDS`; set it to `0` to disable cleanup.

### CodeWhale

CodeWhale v0.8.x can add the Streamable HTTP URL from CLI, but its `mcp add`
command does not expose a `--headers` option. Add the URL first:

```bash
export PMEM_MCP_TOKEN="<gateway-token>"

codewhale-tui mcp add project-memory \
  --url "https://marrow.example.com/api/mcp?client_id=codewhale:${USER}@$(hostname -s)&client_label=CodeWhale%20${USER}@$(hostname -s)&client_kind=codewhale"
```

Then edit the CodeWhale MCP config and add the bearer header manually. Current
versions may use `~/.codewhale/mcp.json` or the legacy `~/.deepseek/mcp.json`.
The resulting entry should look like:

```json
{
  "servers": {
    "project-memory": {
      "command": null,
      "args": [],
      "env": {},
      "url": "https://marrow.example.com/api/mcp?client_id=codewhale:developer@host&client_label=CodeWhale%20developer@host&client_kind=codewhale",
      "disabled": false,
      "enabled": true,
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

Validate it with:

```bash
codewhale-tui mcp validate
codewhale-tui mcp tools project-memory
```

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

For a compact first-run guide, ask for onboarding only:

```text
gateway.manuals(audience="onboarding", includeContent=true)
```

Then ask it to check the shared gateway:

```text
Проверь, что ты подключен к общему pmem gateway.
```

Expected tool flow:

```text
gateway.status
gateway.version
gateway.diagnostics
gateway.clients
```

The gateway should report:

- `mode: gateway`
- `storage: postgresql`
- `tools: 44` for pm3m 1.4.x
- recent clients

Operators can also inspect or clean stale client registrations with:

```text
gateway.client_get
gateway.client_forget
gateway.client_prune
```

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
project.resolve, when repository identity is available
project.current
context.pack(query=<work topic>, mode="brief")
preflight.by_query, if no task exists yet
task.next or task.get
context.pack(taskId=<task id>, mode="brief"), when working from a recorded task
preflight
```

If preflight finds a conflict, the agent should stop and ask for clarification.
Use `context.pack` as the first pass when the goal is to avoid loading full
records, artifact base64, or all manuals into the model context. It returns
compact cards and `nextCalls` for only the records that are worth expanding.

### During Work

The agent should work inside the task scope. If it discovers that the requested
change requires forbidden files, broader architecture changes, or a conflicting
decision, it should ask before continuing.

### After Work

Record only durable knowledge:

- use `event.record` for important history
- use `decision.record` for decisions that should constrain future work
- use `decision.supersede` when replacing an older decision
- use `memory.upsert` for reusable notes that may already exist
- use `failed_attempt.record` when an approach failed and should appear as a
  future `knownFaults` stop-signal
- use `handoff.create` when another agent or later session may continue the work
- use `artifact.put_text` when a reusable text file should be shared with the team
- use `artifact.put` when binary or exact bytes should be shared with the team

Do not record every tiny observation.

Use the right storage surface:

- `memory.*` for compact durable status, conventions, constraints, and links
- `decision.*` for durable architecture, product, or workflow decisions
- `task.*` for executable work with scope and acceptance criteria
- `artifact.*` for files, generated docs, fixtures, templates, and larger
  reusable documents
- `failed_attempt.*` for approaches that should not be repeated blindly
- `handoff.*` for compact session summaries and continuation points

For ChatGPT-Codex collaboration rules, load or read
[PROJECT_MEMORY_COLLABORATION_CONVENTIONS.md](PROJECT_MEMORY_COLLABORATION_CONVENTIONS.md)
through `gateway.manuals(audience="conventions", includeContent=true)`.

Never store secrets, tokens, private keys, cookies, session IDs, full `.env`
files, raw authorization headers, passwords, or raw logs in Project Memory.
Redact before writing if a secret appears in diagnostic output.

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

Use `artifact.list` when browsing a folder-like hierarchy by `pathPrefix` or
tags.

If several templates match, the agent should ask which one to use.

### Download

Artifact search returns a `downloadPath`, for example:

```text
/artifacts/A-COMMON-001/download
```

Append it to `GW_ENDPOINT`:

```text
https://marrow.example.com/api/artifacts/A-COMMON-001/download
```

Bearer auth is still required.

For Markdown or text files, the agent should call `artifact.peek` first when it
needs orientation, then `artifact.read_text` when it needs the actual file text
in model context. Both avoid `contentBase64`. Use `artifact.put_text` when
writing Markdown or text artifacts. Use `artifact.get(includeContent=true)` only
when exact inline base64 content is actually needed. For larger files or binary
files, download from `downloadPath`.

### Upload

Agents should upload Markdown and text artifacts with `artifact.put_text`:

```json
{
  "project": "project-memory-mcp",
  "path": "templates/agents/frontend/AGENTS.md",
  "title": "Frontend AGENTS.md",
  "description": "Reusable frontend agent instructions.",
  "contentType": "text/markdown; charset=utf-8",
  "text": "# AGENTS.md\n\nFrontend instructions...",
  "tags": ["agents", "frontend", "template"],
  "overwrite": false
}
```

Use `artifact.put` only for binary files or exact byte transport:

```json
{
  "project": "project-memory-mcp",
  "path": "assets/diagram.png",
  "title": "Architecture diagram",
  "contentType": "image/png",
  "contentBase64": "<base64 bytes>",
  "tags": ["diagram"],
  "overwrite": false
}
```

For common artifacts, use:

```json
{
  "common": true,
  "path": "templates/agents/frontend/AGENTS.md"
}
```

Use `overwrite: true` only when the replacement is intentional.

When a path already exists, `artifact.put_text` and `artifact.put` return
`ARTIFACT_CONFLICT` with the existing artifact and suggested actions. The safe
choices are:

- use the existing artifact
- retry with `overwrite: true` after explicit confirmation
- upload to a versioned path
- archive the old artifact and then upload to the original path

Use `artifact.update_metadata` when bytes are correct but the title,
description, or tags need cleanup.

Use `artifact.archive` when a file is superseded. Archived files are hidden from
default search but remain available by id/path and with `includeArchived=true`.

## Bundled Templates

The package includes useful starter templates under `docs/templates`. They are
seeded on the gateway as common artifacts after `pm3m migrate latest`.
Client agents do not seed these files locally; they search and download the
gateway source of truth.

Current bundled artifact paths:

- `templates/agents/generic/AGENTS.md`
- `templates/agents/frontend/AGENTS.md`
- `templates/agents/backend/AGENTS.md`
- `templates/agents/devops/AGENTS.md`
- `templates/review/REVIEW_CHECKLIST.md`
- `templates/deploy/DEPLOY_CHECKLIST.md`
- `templates/release/RELEASE_CHECKLIST.md`
- `templates/task/TASK_TEMPLATE.md`
- `templates/handoff/HANDOFF_TEMPLATE.md`
- `templates/fault/FAULT_TEMPLATE.md`

Operators can repeat only the template sync on the gateway:

```bash
pm3m seed templates
```

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

Record a fault or failed attempt:

```text
Запиши fault в pmem: что пробовали, почему не сработало, что не повторять, и лучший следующий подход.
```

Leave a handoff:

```text
Создай handoff в pmem: что сделано, какие файлы трогали, что проверено и что дальше.
```

## Operations Notes

Gateway runtime is configured through `.env`:

```text
BIND=127.0.0.1
PORT=7000
API_ENDPOINT=/api
GW_ENDPOINT=https://marrow.example.com/api
MCP_TOKEN=...
ARTIFACT_DIR=./artifacts
GATEWAY_ANONYMOUS_CLIENT_TTL_SECONDS=86400
PROJECT_MEMORY_PUBLIC_URL=https://marrow.example.com/api
PROJECT_MEMORY_OAUTH_ISSUER=https://marrow.example.com/api
PROJECT_MEMORY_OAUTH_AUDIENCE=https://marrow.example.com/api
PROJECT_MEMORY_MAGIC_TOKEN=...
PROJECT_MEMORY_ALLOWED_REDIRECT_URIS=https://chatgpt.com/connector/oauth/...
PROJECT_MEMORY_OAUTH_CLIENT_ID=chatgpt
# Optional confidential-client secret; omit to use public PKCE client auth.
PROJECT_MEMORY_OAUTH_CLIENT_SECRET=...
# Optional stable signing key; if omitted, tokens are invalidated on restart.
PROJECT_MEMORY_OAUTH_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n..."
LOG_LEVEL=info
LOG_DIR=./logs/
LOG_PRETTY=true
LOG_INCLUDE_TIME=true
LOG_BODY_MAX_CHARS=6000
LOG_FIELD_MAX_CHARS=1200
LOG_ARRAY_MAX_ITEMS=30
LOG_OBJECT_MAX_KEYS=80
```

Gateway request logs include MCP method, tool name, and sanitized request body
summaries. Secret-like fields and values are redacted, `contentBase64` is
omitted, and large bodies are truncated according to the `LOG_*` limits.

Run migrations before starting or after deploys that add tables:

Generate a stable OAuth signing key for `.env` with:

```bash
pm3m oauth key
```

```bash
npm run db:pg:migrate
npm run db:pg:status
```

Start or reload the gateway with PM2:

```bash
npm run build
pm2 startOrReload ecosystem.config.cjs --env production
```

For a server that already has Node, PostgreSQL, and PM2 installed, the package
can be deployed from a tarball without cloning the repository:

```bash
npm install -g ./deadragdoll-pm3m-1.20.0.tgz

mkdir -p /opt/pm3m
cd /opt/pm3m
$EDITOR .env

pm3m migrate
pm3m status
pm3m start
pm2 save
```

Run these commands from the directory that contains the gateway `.env`.
`pm3m migrate` applies PostgreSQL migrations and then seeds or updates bundled
common artifact templates from the installed package into the gateway database
and `ARTIFACT_DIR`.

`pm3m start` generates a local `.pm3m.ecosystem.config.cjs` file that reads
`.env` and starts or reloads the `pm3m-gateway` PM2 process.

The package intentionally has no `postinstall` that starts PM2. Installing or
upgrading a package should not mutate a running service without an explicit
operator command.

Back up both:

- PostgreSQL database
- `ARTIFACT_DIR`

The database contains artifact metadata. The artifact directory contains the
actual file bytes. Losing either side breaks artifact retrieval.

Operators and agents can inspect the expected backup surface with:

```text
gateway.backup_manifest
```

Use [BACKUP_RESTORE.md](BACKUP_RESTORE.md) for the full backup, restore, and
post-restore validation runbook.

## Related Docs

- [MCP_TOOLS.md](MCP_TOOLS.md) describes every tool contract.
- [TOOL_WORKFLOWS.md](TOOL_WORKFLOWS.md) describes recommended tool chains.
- [AGENT_STATE_MACHINE.md](AGENT_STATE_MACHINE.md) defines autonomous agent
  states and clarification triggers.
- [COLLABORATION.md](COLLABORATION.md) explains shared team knowledge goals.
- [NGINX.md](NGINX.md) describes reverse proxy routing.
