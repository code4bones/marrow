# Project Memory MCP — Roadmap

This roadmap starts after the PostgreSQL gateway 1.1 line.

The product is an internal company tool. Gateway authorization is intentionally
simple for now: every developer or agent with the configured bearer token can
use the shared gateway. Do not add roles, ACLs, project permissions, or
multi-tenant auth until there is a concrete product need.

## vNext Priorities

### 1. Gateway Operations

Goal: make the shared gateway easier to inspect and maintain.

Implemented:

- `gateway.version`
- `gateway.diagnostics`
- `gateway.backup_manifest`
- `gateway.clients`
- `gateway.client_get`
- `gateway.client_forget`
- `gateway.client_prune`
- per-client current project state
- temporary anonymous client scope
- automatic anonymous client TTL cleanup
- backup and restore runbook for PostgreSQL plus artifact bytes

Next:

- production verification checklist after `pm3m start`

### 2. Artifact Templates

Goal: make shared files useful immediately for agents.

Next:

- add common `AGENTS.md` templates for frontend, backend, DevOps, and generic repos
- document recommended artifact hierarchy:

```text
/{project}/...
common/templates/...
common/agents/...
```

- add seed/import flow for bundled templates
- add smoke coverage for finding and downloading a template artifact

### 3. Agent UX

Goal: make agents operate pmem as a predictable state machine.

Implemented:

- `gateway.about`
- `gateway.manuals`
- `preflight.by_query`
- `handoff.create`
- tool workflow and state-machine documentation

Next:

- tighten tool descriptions around clarification triggers
- document when agents should use project-specific vs common records
- add examples for multi-agent handoff workflows

### 4. Memory Quality

Goal: reduce duplicate, stale, or low-value memory.

Implemented:

- `memory.upsert`
- `failed_attempt.record`
- `decision.supersede`
- `project.resolve`

Next:

- add examples and smoke coverage for idempotent common memory seeding
- consider a lint/diagnostic tool for duplicate common records
- document archival rules for stale memory items

## Not Planned Yet

These are intentionally deferred:

- public SaaS or multi-tenant mode
- user roles and permissions
- OAuth/OIDC
- embeddings or vector search
- web UI
- remote sync protocol beyond the shared gateway

Revisit these only when the internal trusted gateway model is no longer enough.
