# Project Memory MCP — Collaboration

This document describes how Project Memory MCP supports team collaboration while preserving local-first operation.

## Goal

Multiple developers and agents may work on the same project.

They need access to shared knowledge:

- project decisions
- tasks
- failed attempts
- links
- events
- reusable project context
- common cross-project rules and patterns

The system should prevent knowledge from being trapped in one developer's local SQLite database.

## Runtime Modes

Project Memory MCP supports two runtime modes.

### Local Mode

Local mode runs over stdio and stores data in SQLite.

Use it for:

- single-agent workflows
- local development
- tests
- offline work
- package smoke checks

### Gateway Mode

Gateway mode runs a shared service and stores data in PostgreSQL.

Use it for:

- multiple developers working on one project
- multiple agents sharing project memory
- shared common knowledge
- centralized preflight context
- durable team audit history

Gateway mode is the correct collaboration runtime. Do not use a shared SQLite file as the main team database.

Current gateway commands:

```bash
npm run build
npm run db:pg:migrate
npm run gateway
```

For long-running shared deployments, PM2 can run the gateway from `.env`:

```bash
pm2 startOrReload ecosystem.config.cjs --env production
```

`ecosystem.config.cjs` uses the gateway-specific `BIND` and `PORT` variables.

Agents connect directly to the MCP Streamable HTTP endpoint:

```text
http://127.0.0.1:8765/mcp
```

Keep gateway runtime and client connection variables separate. Gateway-specific variables such as `BIND`, `PORT`, `API_ENDPOINT`, and `MCP_TOKEN` describe how the shared service runs. Client-specific variables such as `GW_ENDPOINT` and `MCP_CLIENT_AUTH` describe how agents connect to it. `GW_ENDPOINT` is the public gateway base URL; MCP clients use `${GW_ENDPOINT}/mcp`.

Each MCP HTTP client should send stable `X-Project-Memory-Client-*` headers when client identity matters.

The gateway records clients in `gateway_clients` and exposes them through `gateway.clients`. `gateway.status` reports shared gateway health and record counts.

In gateway mode, `project.set_current` is scoped to the requesting client id.
One developer or agent changing current project must not change another
client's implicit project scope. The legacy global `current_project_id` key is
kept only as a fallback for older deployments.

Requests without a client id are assigned temporary `anonymous:<request-id>`
identity. This avoids one shared anonymous current project, but those requests
should not be treated as durable agent sessions. Configure a stable `client_id`
for normal collaboration.

## Collaboration-Ready Principles

### 1. Local-first remains supported

Every developer should be able to run the MCP server locally with SQLite.

Collaboration adds gateway mode; it does not remove local operation.

### 2. Stable IDs matter

Records should keep stable, human-readable IDs where practical:

```text
P-MEMORY
T-MEMORY-001
D-MEMORY-001
C-AGENT-001
```

Stable IDs make exported memory reviewable and mergeable.

### 3. Events stay append-only

Collaboration must not casually rewrite history.

When records are imported, synced, superseded, or merged, record events such as:

```text
memory.imported
memory.exported
sync.applied
sync.conflict_detected
decision.superseded
```

### 4. Common knowledge is shared deliberately

Common knowledge should be reusable across projects and developers.

Common records should not become a dump for one-off project facts.

Team-shared common rules should be:

- explicit
- tagged
- reviewable
- exportable

### 5. Project knowledge overrides common knowledge

When common and project-specific records conflict, project records win for that project.

Preflight and search should continue to rank project records before common records.

### 6. PostgreSQL is the shared source of truth

For gateway mode, PostgreSQL should be the primary database.

Reasons:

- safe concurrent reads/writes
- transactions and row locks
- JSONB for structured fields
- mature migrations and backup tooling
- full-text search support
- future permissions/provenance/audit support

SQLite remains valid for embedded local operation.

### 7. Provenance should be added before broad shared rollout

Before broad shared rollout, records should gain provenance fields or metadata.

Useful future fields:

```text
created_by
updated_by
source
source_instance_id
origin_project_id
imported_at
updated_at
version
```

These do not need to be implemented immediately, but future migrations should account for them.

## Recommended Evolution Path

### Phase 1: Storage boundary

Introduce a storage boundary so feature services do not permanently depend on `better-sqlite3`.

Capabilities:

- SQLite backend for local mode
- PostgreSQL backend for gateway mode
- explicit SQL per dialect where needed
- shared repository/service contracts
- migration runners per backend

### Phase 2: PostgreSQL schema and migrations

Add PostgreSQL migrations that mirror the current core tables:

```text
projects
items
tasks
decisions
links
events
kv
migrations
```

Use PostgreSQL-native search for shared memory instead of SQLite FTS5.

### Phase 3: Common gateway API

Expose a common gateway over HTTP for multiple clients.

Implemented endpoints are minimal:

```http
POST /mcp
GET /health
GET /tools
POST /call
```

The gateway exposes MCP directly over Streamable HTTP at `POST /mcp`. `POST /call` remains a low-level JSON tool-call endpoint for diagnostics and simple integrations.

### Phase 4: Client access model

Use MCP Streamable HTTP clients directly against the gateway.

This preserves agent compatibility while removing the local stdio proxy layer.

### Phase 5: Auth, permissions, and provenance

Add only after the shared gateway works in trusted environments.

Required:

- auth model
- permissions
- created_by/updated_by
- source instance IDs
- audit events
- audit events

## Conflict Handling Direction

MVP should not solve conflicts automatically.

Gateway writes should eventually detect:

- same ID with different content
- superseded decision still referenced
- task status divergence
- common rule changed in incompatible ways
- deleted local record still referenced by links/events

Initial behavior should be conservative:

```text
detect -> report -> require explicit resolution
```

Automatic merge can come later.

## Tooling Implications

Gateway-related tools may include:

```text
gateway.health
gateway.status
gateway.list_clients
sync.preview
sync.conflicts
```

These should not replace the current tools. They should sit around the existing project/memory/task/decision/event/link model.

## Current Practical Rule

For now, treat collaboration as an active architecture requirement:

- keep records typed
- keep IDs stable
- keep docs human-readable
- keep events append-only
- avoid hidden local-only assumptions
- implement PostgreSQL-backed gateway mode before adding advanced auth/permissions
