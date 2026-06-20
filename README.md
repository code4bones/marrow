# Project Memory MCP

Local-first MCP server for structured project memory used by coding agents.

The default local stdio server stores projects, common knowledge, memory items, tasks, decisions, links, events, and preflight context in SQLite. Search uses SQLite FTS5.

Shared gateway mode stores the same tool model in PostgreSQL and exposes it through an HTTP gateway with a direct MCP Streamable HTTP endpoint.
Preflight output includes `knownFaults` so agents can avoid repeating failed
commands, deploy paths, migrations, and implementation approaches.

## Current Status

Implemented local/core MCP tools:

- `project.create`
- `project.list`
- `project.get`
- `project.set_current`
- `project.current`
- `memory.create`
- `memory.get`
- `memory.search`
- `memory.update`
- `task.create`
- `task.list`
- `task.get`
- `task.next`
- `task.update_status`
- `decision.record`
- `decision.list`
- `decision.get`
- `event.record`
- `event.list`
- `link.create`
- `link.list`
- `preflight`

Shared PostgreSQL gateway mode exposes the same core model plus gateway and
collaboration tools. Current gateway smoke coverage expects 52 tools, including:

- `gateway.about`
- `gateway.version`
- `gateway.diagnostics`
- `gateway.backup_manifest`
- `gateway.manuals`
- `gateway.status`
- `gateway.clients`
- `gateway.client_get`
- `gateway.client_forget`
- `gateway.client_prune`
- `project.resolve`
- `project.summary`
- `memory.upsert`
- `memory.hygiene_report`
- `failed_attempt.record`
- `decision.supersede`
- `artifact.put`
- `artifact.search`
- `artifact.list`
- `artifact.peek`
- `artifact.read_text`
- `artifact.get`
- `artifact.update_metadata`
- `artifact.archive`
- `preflight.by_query`
- `context.pack`
- `context.changed_since`
- `handoff.create`
- `handoff.latest`
- `handoff.search`

New agents can request the compact first-run guide with
`gateway.manuals(audience="onboarding", includeContent=true)`.

See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for the detailed implementation status, validation notes, and known follow-up work.

See [docs/DEVELOPER_MANUAL.md](docs/DEVELOPER_MANUAL.md) for a practical developer guide covering purpose, setup, safe usage, artifacts, and operations.

See [docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md) for the operational guide agents should follow when deciding whether and how to use pmem.

See [docs/TOOL_WORKFLOWS.md](docs/TOOL_WORKFLOWS.md) for recommended tool chains agents should follow.

See [docs/AGENT_STATE_MACHINE.md](docs/AGENT_STATE_MACHINE.md) for the agent state machine and clarification triggers.

See [docs/COLLABORATION.md](docs/COLLABORATION.md) for how the local-first MVP is designed to evolve toward shared team knowledge.

See [docs/PROJECT_MEMORY_COLLABORATION_CONVENTIONS.md](docs/PROJECT_MEMORY_COLLABORATION_CONVENTIONS.md) for the storage-surface mapping and collaboration rules shared by ChatGPT, Codex, and other agents.

See [docs/NGINX.md](docs/NGINX.md) for nginx reverse proxy locations for the shared gateway.

See [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) for the PostgreSQL plus artifact backup and restore runbook.

## Setup

```bash
npm install
npm run build
```

Default database path:

```text
.agent/project-memory.sqlite
```

Override it with:

```bash
PROJECT_MEMORY_DB=/path/to/project-memory.sqlite
```

Shared gateway mode uses PostgreSQL. Configure it through `POSTGRES_*` variables:

```bash
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=project_memory
POSTGRES_USER=project_memory
POSTGRES_PASSWORD=...
POSTGRES_SSL=false
```

Run PostgreSQL migrations:

```bash
npm run db:pg:migrate
npm run db:pg:status
```

## Seed Common Memory

```bash
npm run seed:common
```

This creates the `project-memory-mcp` project if missing, sets it as current, and seeds common rules such as:

- `C-AGENT-001`
- `C-AGENT-002`
- `C-AGENT-003`
- `C-AGENT-004`
- `C-TASK-001`
- `C-TASK-002`
- `C-ARCH-001`
- `C-ARCH-002`

## Run MCP Server

Development:

```bash
npm run dev
```

Built server:

```bash
npm run build
node dist/src/index.js
```

MCP clients should run the server over stdio.

Example command:

```bash
node /absolute/path/to/project-memory-mcp/dist/src/index.js
```

## Run Shared Gateway

Build first, then start the PostgreSQL-backed gateway:

```bash
npm run build
npm run db:pg:migrate
npm run gateway
```

Gateway-specific runtime variables:

```text
BIND=127.0.0.1
PORT=8765
API_ENDPOINT=/api
MCP_TOKEN=...
ARTIFACT_DIR=./artifacts
GATEWAY_ANONYMOUS_CLIENT_TTL_SECONDS=86400
PROJECT_MEMORY_PUBLIC_URL=https://pmem.undoo.ru/api
PROJECT_MEMORY_OAUTH_ISSUER=https://pmem.undoo.ru/api
PROJECT_MEMORY_OAUTH_AUDIENCE=https://pmem.undoo.ru/api
PROJECT_MEMORY_MAGIC_TOKEN=...
PROJECT_MEMORY_ALLOWED_REDIRECT_URIS=https://chatgpt.com/connector/oauth/...
PROJECT_MEMORY_OAUTH_CLIENT_ID=chatgpt
# Optional confidential-client secret; omit to use public PKCE client auth.
PROJECT_MEMORY_OAUTH_CLIENT_SECRET=...
# Optional stable signing key; if omitted, tokens are invalidated on restart.
PROJECT_MEMORY_OAUTH_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n..."
```

The Node gateway listens on internal unprefixed routes such as `/mcp`, `/health`, and `/ready`; `API_ENDPOINT` is the public reverse-proxy prefix, for example `/api`.

Gateway authorization is intentionally simple for trusted internal deployments:
any client with the configured bearer token can use the shared gateway. Per-user
roles, ACLs, and project permissions are not part of the current product stage.
For ChatGPT Apps/custom MCP Apps, set `PROJECT_MEMORY_MAGIC_TOKEN` and
`PROJECT_MEMORY_PUBLIC_URL` to enable the minimal OAuth facade. The magic token
is used only at `/oauth/authorize`; ChatGPT receives an OAuth bearer token and
never sees `MCP_TOKEN`. The authorization code is short-lived and one-time-use,
but the issued access token intentionally has no expiration so ChatGPT does not
drop the MCP authorization during long-lived chats. Set `PROJECT_MEMORY_OAUTH_PRIVATE_KEY_PEM`
for stable JWT signing across restarts. Set `PROJECT_MEMORY_OAUTH_CLIENT_ID`
when ChatGPT gives you a predefined OAuth client id. If ChatGPT also gives you a
client secret, set `PROJECT_MEMORY_OAUTH_CLIENT_SECRET`; the token endpoint then
accepts `client_secret_post` and `client_secret_basic`.

Generate that `.env` value with:

```bash
pm3m oauth key
```

For PM2 deployments, use the included ecosystem file. It loads `.env`, watches the built gateway files and migrations, and maps `BIND`/`PORT` into the gateway runtime:

```bash
npm run build
pm2 startOrReload ecosystem.config.cjs --env production
```

For package deployments, install the packed artifact globally and run the
gateway commands from the deployment directory that contains `.env`:

```bash
npm install -g ./deadragdoll-pm3m-1.13.0.tgz

mkdir -p /opt/pm3m
cd /opt/pm3m
$EDITOR .env

pm3m migrate
pm3m status
pm3m start
pm2 save
```

`pm3m migrate` is a gateway-side operation: it applies PostgreSQL migrations
and then seeds or updates bundled common artifact templates from the installed
package into PostgreSQL plus `ARTIFACT_DIR`. Clients do not seed templates
locally; they discover gateway templates with `artifact.search`,
`artifact.list`, `artifact.peek`, `artifact.read_text`, and `artifact.get`. Run `pm3m seed templates` on the gateway
only when you need to repeat just the template sync.

There is intentionally no `postinstall` side effect. Installing the package
does not start or reload PM2 automatically; service changes should happen only
through explicit deploy commands such as `pm3m start`.

`MCP_TOKEN` enables bearer auth for gateway routes.
OAuth access tokens are also accepted when the OAuth facade is enabled.

Client-specific variables point agents at the public gateway base URL:

```text
GW_ENDPOINT=https://pmem.undoo.ru/api
MCP_CLIENT_AUTH=...
```

Clients append the concrete route they need, for example `${GW_ENDPOINT}/mcp` for MCP Streamable HTTP or `${GW_ENDPOINT}/ready` for readiness.

For local direct testing without nginx, `GW_ENDPOINT` can point at the internal gateway base URL:

```text
GW_ENDPOINT=http://127.0.0.1:8765
```

`MCP_CLIENT_AUTH` should provide the bearer token value expected by the gateway.

For shared teams, MCP HTTP clients may also send `X-Project-Memory-Client-*` headers for stable client identity.
The gateway scopes implicit current project state to this client id. Requests
without a client id get a temporary `anonymous:<request-id>` scope, which is
isolated but not durable.
Temporary anonymous client records and their current-project keys are cleaned
up after `GATEWAY_ANONYMOUS_CLIENT_TTL_SECONDS`; set it to `0` to disable this
cleanup.

Codex CLI streamable HTTP MCP config does not currently expose custom headers, so pass client identity through URL query parameters:

```bash
export PMEM_MCP_TOKEN="<token>"

codex mcp add project-memory \
  --url "https://pmem.undoo.ru/api/mcp?client_id=${USER}@$(hostname -s)&client_label=${USER}@$(hostname -s)&client_kind=codex" \
  --bearer-token-env-var PMEM_MCP_TOKEN
```

CodeWhale v0.8.x can add the Streamable HTTP URL from CLI, but its `mcp add`
command does not expose a `--headers` option. Add the URL first:

```bash
export PMEM_MCP_TOKEN="<token>"

codewhale-tui mcp add project-memory \
  --url "https://pmem.undoo.ru/api/mcp?client_id=codewhale:${USER}@$(hostname -s)&client_label=CodeWhale%20${USER}@$(hostname -s)&client_kind=codewhale"
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
      "url": "https://pmem.undoo.ru/api/mcp?client_id=codewhale:developer@host&client_label=CodeWhale%20developer@host&client_kind=codewhale",
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

Gateway-only MCP tools:

- `gateway.about`
- `gateway.version`
- `gateway.diagnostics`
- `gateway.backup_manifest`
- `gateway.manuals`
- `gateway.status`
- `gateway.clients`
- `gateway.client_get`
- `gateway.client_forget`
- `gateway.client_prune`
- `project.resolve`
- `memory.upsert`
- `failed_attempt.record`
- `decision.supersede`
- `artifact.put`
- `artifact.search`
- `artifact.list`
- `artifact.peek`
- `artifact.read_text`
- `artifact.get`
- `artifact.update_metadata`
- `artifact.archive`
- `preflight.by_query`
- `handoff.create`

Bundled gateway templates are seeded as common artifacts under:

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

Gateway logging uses `pino` and writes JSON logs to console and file by default:

```text
LOG_LEVEL=info
LOG_DIR=./logs/
LOG_PRETTY=false
LOG_INCLUDE_TIME=true
```

The gateway writes pretty logs to stderr when `LOG_PRETTY=true`; `LOG_INCLUDE_TIME` controls the pretty console timestamp. The file `${LOG_DIR}/project-memory-gateway.log` always uses pino JSON lines with local timestamps for monitoring ingestion. Set `LOG_DIR=false` to disable file logging.

For the internal nginx server template, see `deploy/nginx/project-memory-gateway.server.conf`. For reusable locations only, see `deploy/nginx/project-memory-gateway.locations.conf`.

Gateway health endpoints:

```text
GET /health  process liveness
GET /ready   PostgreSQL and migration-table readiness
```

## Distribution Contents

The npm package includes the built server, built helper scripts, migrations, and project documentation:

- `dist/src`
- `dist/scripts`
- `deploy`
- `migrations`
- `knexfile.cjs`
- `docs`
- `README.md`
- `AGENTS.md`

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke
npm run smoke:gateway
npm run smoke:gateway:mcp-http
npm run smoke:stdio
npm run smoke:package
```

`smoke:package` packs the npm tarball, extracts it into a temporary directory, verifies packaged docs/migrations, starts the packaged server over stdio, and calls MCP tools. It links the current `node_modules` into the extracted package so the check stays fast and does not rebuild native dependencies.

`smoke:gateway` requires PostgreSQL env vars and migrations. It starts the gateway on a random local port, creates a temporary project, checks HTTP tools/search/preflight, then removes the created project.

`smoke:gateway:mcp-http` verifies the full shared path: MCP Streamable HTTP client -> HTTP gateway -> PostgreSQL.

## Notes

- The server is local-first.
- There is no UI, auth, remote sync, cloud dependency, embeddings, or vector search in the MVP.
- Project-specific memory and common memory are separate. Default search includes current project plus common knowledge.
- `preflight` is the main workflow guardrail before editing project files.
