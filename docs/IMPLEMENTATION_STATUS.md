# Project Memory MCP — Implementation Status

This document records what has been implemented so far and what remains after the first MVP implementation pass.

## Implemented Scope

The repository now contains a working local-first TypeScript MCP server with SQLite persistence and an initial PostgreSQL-backed shared gateway.

Implemented capabilities:

- project registry
- common knowledge layer
- typed memory items
- SQLite FTS5 search for memory items
- tasks
- decisions
- events
- links
- preflight context
- common seed script
- MCP stdio server
- PostgreSQL schema and Knex migrations for shared gateway mode
- PostgreSQL gateway tool service
- HTTP gateway routes: `POST /mcp`, `GET /health`, `GET /ready`, `GET /tools`, `POST /call`
- MCP Streamable HTTP gateway endpoint
- gateway client registry through `gateway_clients`
- per-client current project state in shared gateway mode
- temporary anonymous gateway client scopes for requests without `client_id`
- configurable cleanup for temporary anonymous gateway clients and their current-project keys
- operator client management through `gateway.client_get`, `gateway.client_forget`, and `gateway.client_prune`
- gateway diagnostics and onboarding: `gateway.about`, `gateway.version`, `gateway.diagnostics`, `gateway.backup_manifest`, `gateway.manuals`, `gateway.manuals(audience="onboarding")`, `gateway.status`, `gateway.clients`
- gateway memory-quality tools: `memory.upsert`, `memory.hygiene_report`, `failed_attempt.record`, `decision.supersede`, `project.resolve`, `project.summary`
- preflight `knownFaults` alias for failed attempts that should stop repeated mistakes
- artifact metadata in PostgreSQL and artifact bytes on gateway filesystem
- artifact metadata update, archival lifecycle, and deterministic listing
- ad-hoc preflight context through `preflight.by_query`
- compact start-of-work context through `context.pack`
- compact incremental refresh through `context.changed_since`
- compact continuation records through `handoff.create`
- backup and restore runbook for PostgreSQL plus artifact bytes
- tests, typecheck, lint, and build scripts

The implementation intentionally does not include UI, complex auth/permissions, remote sync, cloud dependencies, embeddings, or vector search. Gateway mode provides shared storage for trusted internal team environments. Authorization is a shared bearer token; any client with the configured token can use the gateway. Full conflict resolution and permissions remain follow-up work.

## Runtime Stack

- Node.js
- TypeScript
- MCP SDK
- SQLite through `better-sqlite3`
- SQLite FTS5
- PostgreSQL through `pg`
- Knex for PostgreSQL migrations and gateway queries
- Pino for gateway JSON logging
- Zod for runtime validation
- Vitest for tests
- ESLint for linting

## Distribution Contents

The package distributive is intentionally limited through `package.json` `files`.

Included:

- `dist/src`
- `dist/scripts`
- `deploy`
- `docs`
- `migrations`
- `knexfile.cjs`
- `README.md`
- `AGENTS.md`

Excluded:

- TypeScript source files
- tests
- local SQLite data
- local MCP environment files
- build and lint configuration

Runtime migration discovery uses the nearest package root instead of assuming the current working directory, so the built server can run after package installation.

PostgreSQL shared gateway migrations are managed through Knex:

```bash
npm run db:pg:migrate
npm run db:pg:status
```

Gateway runtime commands:

```bash
npm run build
npm run gateway
```

PM2 deployment is supported through `ecosystem.config.cjs`. It loads `.env`, uses `BIND`/`PORT`, watches `dist/src`, migrations, `knexfile.cjs`, and `.env`, and runs the built gateway:

```bash
pm2 startOrReload ecosystem.config.cjs --env production
```

Shared agents should connect to the MCP Streamable HTTP endpoint:

```text
http://127.0.0.1:8765/mcp
```

PMemUI and browser-facing clients can use the gateway GraphQL endpoint:

```text
${GW_ENDPOINT}/graphql
```

The GraphQL slice maps to existing gateway tools for gateway status, projects,
project summaries, memory search, tasks, decisions, artifacts, artifact text,
events, and controlled mutations for project/task/artifact maintenance. The
endpoint uses the same gateway authorization as `/mcp` and `/call`; GraphQL
queries require OAuth `memory:read`, while mutations require `memory:read` and
`memory:write`. On production this resolves to
`https://pmem.undoo.ru/api/graphql`. `OPTIONS /graphql` and
`OPTIONS ${API_ENDPOINT}/graphql` support browser CORS preflight. See
`docs/GRAPHQL_API.md`.

PMemUI table queries have paginated variants such as `projectsPage`,
`tasksPage`, `decisionsPage`, `artifactsPage`, `artifactSearchPage`,
`memorySearchPage`, `eventsPage`, and `gatewayClientsPage`. They accept
`PaginationInput { limit, offset }` and return `{ items, pageInfo }` with
`totalCount`, `hasNextPage`, and `hasPreviousPage`. Pagination is executed in
PostgreSQL with `COUNT(*)`, `LIMIT`, and `OFFSET`.

Gateway-specific `.env` variables control the server process: `BIND`, `PORT`, `API_ENDPOINT`, optional `MCP_TOKEN`, optional `ARTIFACT_DIR`, and `GATEWAY_ANONYMOUS_CLIENT_TTL_SECONDS`. OAuth facade variables include `PROJECT_MEMORY_PUBLIC_URL`, `PROJECT_MEMORY_OAUTH_ISSUER`, `PROJECT_MEMORY_OAUTH_AUDIENCE`, `PROJECT_MEMORY_MAGIC_TOKEN` or `PROJECT_MEMORY_MAGIC_TOKEN_HASH`, `PROJECT_MEMORY_ALLOWED_REDIRECT_URIS`, optional `PROJECT_MEMORY_OAUTH_CLIENT_ID`, optional `PROJECT_MEMORY_OAUTH_CLIENT_SECRET`, optional authorization-code TTL, and optional OAuth scope/key settings. Client-specific `.env` variables control agent connections: `GW_ENDPOINT` points to the public gateway base URL, and clients append routes such as `/mcp`; `MCP_CLIENT_AUTH` carries the bearer token expected by the gateway. Client identity is provided through `X-Project-Memory-Client-*` request headers when needed.

OAuth tokens are checked per tool. Read-only tools require `memory:read`; write
tools such as `project.create`, `task.create`, `artifact.put_text`,
`memory.update`, `handoff.create`, and status/archive-changing tools require
both `memory:read` and `memory:write`.

OAuth resource validation accepts the configured audience and the MCP endpoint
resource (`PROJECT_MEMORY_PUBLIC_URL + "/mcp"`) so stricter clients such as
Claude Custom Connectors can bind tokens to `/api/mcp` while ChatGPT-style
clients can continue using the gateway base resource. The gateway also serves
RFC 8414 path-insertion discovery routes such as
`/.well-known/oauth-authorization-server/api` when nginx forwards them.

Claude Custom Connectors reject dots in tool names. When a gateway MCP request
uses `client_kind` containing `claude`, the MCP tool list exposes Claude-safe
aliases such as `project_create`, `artifact_read_text`, and `gateway_status`.
The gateway maps those aliases to canonical tools such as `project.create`
internally. Non-Claude clients continue to receive canonical dotted names.

Artifacts are stored on the gateway filesystem under `ARTIFACT_DIR` or `./artifacts` by default. Metadata is stored in PostgreSQL and exposed through `artifact.put_text`, `artifact.put`, `artifact.search`, `artifact.peek`, `artifact.read_text`, `artifact.get`, and authenticated download routes.

Gateway MCP tools publish `outputSchema` in `tools/list`. Every tool exposes the
common `{ ok, summary, data, error }` response envelope; artifact and compact
context tools provide more specific `data` shapes for tool chaining.

Gateway logging uses `pino`:

```text
LOG_LEVEL=info
LOG_DIR=./logs/
LOG_PRETTY=false
LOG_INCLUDE_TIME=true
LOG_BODY_MAX_CHARS=6000
LOG_FIELD_MAX_CHARS=1200
LOG_ARRAY_MAX_ITEMS=30
LOG_OBJECT_MAX_KEYS=80
```

Console logs are written to stderr and can be formatted with `LOG_PRETTY=true`; `LOG_INCLUDE_TIME` controls the pretty console timestamp. File logs are written as pino JSON lines with local timestamps to `${LOG_DIR}/project-memory-gateway.log` unless `LOG_DIR=false`.

Completed gateway request logs include MCP method, MCP tool name, sanitized
request bodies, and OAuth form summaries. Secret-like fields are redacted,
`contentBase64` is omitted, and large values are truncated with the `LOG_*`
body limits.

## Source Layout

The code follows the feature-oriented structure described in `docs/ARCHITECTURE.md`.

```text
src/
  app/
    bootstrap.ts
    config.ts

  gateway/
    http-server.ts
    mcp-server.ts
    pg-tool-service.ts
    tool-definitions.ts

  features/
    projects/
    memory/
    tasks/
    decisions/
    events/
    links/
    preflight/

  shared/
    db/
    ids/
    mcp/
    pg/
    logging/
```

Each feature is split into:

- `model/` for types and validation schemas
- `repo/` for SQL access
- `service/` for business behavior
- `mcp/` for MCP tool handlers

Dependency direction is:

```text
app -> features -> shared
```

`shared` does not import from feature modules.

## Database

The initial migration is:

```text
migrations/001_init.sql
```

It creates:

- `projects`
- `items`
- `items_fts`
- FTS triggers for `items`
- `tasks`
- `decisions`
- `links`
- `events`
- `kv`
- `migrations`

Default database path:

```text
.agent/project-memory.sqlite
```

Override:

```bash
PROJECT_MEMORY_DB=/path/to/project-memory.sqlite
```

PostgreSQL gateway schema lives in:

```text
migrations/pg/001_init.cjs
```

It creates PostgreSQL equivalents for core records and adds gateway-specific collaboration metadata:

- `gateway_clients`
- `sync_conflicts`
- JSONB fields for structured arrays/metadata
- generated `tsvector` search for memory items

## MCP Tools

Implemented tools:

- `project.create`
- `project.list`
- `project.get`
- `project.delete` (gateway)
- `project.resolve` (gateway)
- `project.summary` (gateway)
- `project.set_current`
- `project.current`
- `memory.create`
- `memory.get`
- `memory.search`
- `memory.update`
- `memory.upsert` (gateway)
- `memory.hygiene_report` (gateway)
- `failed_attempt.record` (gateway)
- `task.create`
- `task.list`
- `task.get`
- `task.delete` (gateway)
- `task.next`
- `task.update_status`
- `decision.record`
- `decision.supersede` (gateway)
- `decision.list`
- `decision.get`
- `event.record`
- `event.list`
- `link.create`
- `link.list`
- `preflight`
- `preflight.by_query` (gateway)
- `context.pack` (gateway)
- `context.changed_since` (gateway)
- `handoff.create` (gateway)
- `handoff.latest` (gateway)
- `handoff.search` (gateway)
- `artifact.put` (gateway)
- `artifact.put_text` (gateway)
- `artifact.search` (gateway)
- `artifact.list` (gateway)
- `artifact.peek` (gateway)
- `artifact.read_text` (gateway)
- `artifact.get` (gateway)
- `artifact.update_metadata` (gateway)
- `artifact.archive` (gateway)
- `gateway.about` (gateway)
- `gateway.version` (gateway)
- `gateway.diagnostics` (gateway)
- `gateway.backup_manifest` (gateway)
- `gateway.manuals` (gateway)
- `gateway.manuals(audience="onboarding")` returns `docs/AGENT_ONBOARDING.md`
- `gateway.status` (gateway)
- `gateway.clients` (gateway)

Tool handlers validate inputs with Zod, call services, and return structured success/error payloads.

In gateway mode, the HTTP MCP endpoint exposes the same core tool names and schemas plus gateway diagnostics, artifact storage, collaboration, and memory-quality tools. Local SQLite stdio remains the compact core tool surface.

Recommended tool chains are documented in `docs/TOOL_WORKFLOWS.md`.

The agent state machine and clarification triggers are documented in `docs/AGENT_STATE_MACHINE.md`.

Collaboration readiness is documented in `docs/COLLABORATION.md`; collaboration is a design constraint, while remote sync remains outside the current MVP.

Future frontend direction is documented in `docs/FRONTEND_UI_CONCEPT.md`. That
document describes a React/TypeScript/Vite/Zustand/GraphQL operational UI for
browsing projects, tasks, decisions, faults, artifacts, events, clients, and
diagnostics without changing the current backend-first MVP scope.
The initial gateway GraphQL API contract is documented in `docs/GRAPHQL_API.md`.

## Event Behavior

The implementation records events for write operations that should leave project history.

Automatic event examples:

- `project.created`
- `item.created`
- `item.updated`
- `task.created`
- `task.started`
- `task.completed`
- `task.blocked`
- `task.cancelled`
- `task.deleted`
- `decision.recorded`
- `link.created`

Manual event recording is available through `event.record`.

## Search

Memory search uses SQLite FTS5 through `items_fts`.

Default behavior:

- include current project records
- include common records unless disabled
- rank project records before common records
- support filters for type, status, and limit

Search currently indexes generic memory items. Tasks and decisions are not indexed through dedicated FTS tables yet.

## Preflight

`preflight` accepts a task id and returns compact execution context:

- project summary
- task summary
- acceptance criteria
- allowed files
- forbidden files
- dependencies
- active project/common decisions
- common rules
- related memory items
- failed attempts
- recent project events

This is the main guardrail workflow before implementation tasks.

## Seed Data

The common seed script is:

```bash
npm run seed:common
```

It creates the `project-memory-mcp` project if missing, sets it as current, and seeds stable common records:

- `C-AGENT-001`
- `C-AGENT-002`
- `C-AGENT-003`
- `C-AGENT-004`
- `C-TASK-001`
- `C-TASK-002`
- `C-ARCH-001`
- `C-ARCH-002`

Bundled artifact templates live in `docs/templates` and are synced to common
gateway artifacts by `pm3m migrate latest`. Operators can repeat only the
template sync with:

```bash
pm3m seed templates
npm run seed:templates
```

Template sync validates both PostgreSQL artifact metadata and files under
`ARTIFACT_DIR`; if bytes are missing or stale, the seed rewrites them.

Current template artifact paths:

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

## Validation

Current validation commands:

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

Current test coverage includes:

- migration bootstrap
- project creation
- project + common FTS search
- project and memory write events
- task lifecycle events
- decision recording
- preflight context
- link creation/listing
- validation error mapping
- MCP protocol smoke test through in-memory transport
- CLI smoke test through `npm run smoke`
- built stdio server smoke test through `npm run smoke:stdio`
- package tarball smoke test through `npm run smoke:package`

## Commit Checkpoints

Recent implementation checkpoints:

- `20fbd72 Add TypeScript lint check`
- `e4ae57a Add MCP protocol smoke test`
- `8212740 Fix package entrypoint and validation errors`
- `cae0d24 Record project and memory write events`
- `a0cd254 Document usage and seed stable common ids`
- `8eb804b Add link tools`
- `c501b14 Add tasks decisions events and preflight`
- `8c90590 bootstrap`

## Known Gaps

The current implementation is useful as an MVP but still has several practical follow-ups:

- exercise the server in the target MCP client configuration
- include linked records in `preflight`
- include task dependencies in richer form
- add Markdown export snapshots under `docs/generated/`
- add import from structured Markdown
- add dedicated FTS support for tasks and decisions if needed
- improve ID generation beyond simple sequential prefixes
- add more tests around error cases and edge cases
- document MCP client configuration examples

## Recommended Next Step

Exercise the built server in the target MCP client configuration and verify that the client can list and call the implemented tools.
