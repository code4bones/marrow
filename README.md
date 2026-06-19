# Project Memory MCP

Local-first MCP server for structured project memory used by coding agents.

The default local stdio server stores projects, common knowledge, memory items, tasks, decisions, links, events, and preflight context in SQLite. Search uses SQLite FTS5.

Shared gateway mode stores the same tool model in PostgreSQL and exposes it through an HTTP gateway with a direct MCP Streamable HTTP endpoint.

## Current Status

Implemented core MVP tools:

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

See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for the detailed implementation status, validation notes, and known follow-up work.

See [docs/TOOL_WORKFLOWS.md](docs/TOOL_WORKFLOWS.md) for recommended tool chains agents should follow.

See [docs/AGENT_STATE_MACHINE.md](docs/AGENT_STATE_MACHINE.md) for the agent state machine and clarification triggers.

See [docs/COLLABORATION.md](docs/COLLABORATION.md) for how the local-first MVP is designed to evolve toward shared team knowledge.

See [docs/NGINX.md](docs/NGINX.md) for nginx reverse proxy locations for the shared gateway.

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
```

The Node gateway listens on internal unprefixed routes such as `/mcp`, `/health`, and `/ready`; `API_ENDPOINT` is the public reverse-proxy prefix, for example `/api`.

For PM2 deployments, use the included ecosystem file. It loads `.env`, watches the built gateway files and migrations, and maps `BIND`/`PORT` into the gateway runtime:

```bash
npm run build
pm2 startOrReload ecosystem.config.cjs --env production
```

`MCP_TOKEN` enables bearer auth for gateway routes.

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

Gateway-only MCP tools:

- `gateway.status`
- `gateway.clients`

Gateway logging uses `pino` and writes JSON logs to console and file by default:

```text
LOG_LEVEL=info
LOG_DIR=./logs/
LOG_PRETTY=false
LOG_INCLUDE_TIME=true
```

The gateway writes to stderr and to `${LOG_DIR}/project-memory-gateway.log`. Set `LOG_DIR=false` to disable file logging. `LOG_PRETTY=true` formats both console and file output for humans; otherwise pino writes JSON lines.

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
