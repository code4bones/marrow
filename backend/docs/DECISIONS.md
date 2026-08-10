# Project Memory MCP — Decisions

This document records important project decisions until the MCP memory server is used to store its own decisions.

## D-MEMORY-001: MVP is local-first stdio

Status: accepted

Context:

The first useful version should be easy to run locally from agent environments and should avoid auth, networking, hosted services, and operational overhead.

Decision:

The MVP uses stdio MCP transport and local SQLite persistence.

Rationale:

This keeps setup simple, inspectable, and reliable for single-agent workflows while the core memory model stabilizes.

Consequences:

- no SSE/HTTP server in MVP
- no auth in MVP
- no remote sync in MVP
- package distributive must include migrations and docs
- future collaboration must be added without breaking the local-first workflow

## D-MEMORY-002: Collaboration is now an explicit product requirement

Status: accepted

Context:

A single project may have multiple developers and agents. Project and common knowledge should be shareable across the team, not trapped in one developer's local database.

Decision:

Collaboration is no longer only a future concern. The system must support a shared team knowledge path through a common gateway while preserving local-first operation for individual agents.

Rationale:

Multiple developers can work on one project, and memory that affects decisions, failed attempts, and preflight should be available to all of them. Treating each local SQLite database as isolated would make the system unreliable for teams.

Consequences:

- records should keep stable human-readable ids
- schema should add author/source/provenance fields before broad rollout
- common gateway mode should be supported as a first-class runtime
- common knowledge should be shareable across projects and developers
- project-specific knowledge must remain scoped and override common knowledge
- append-only events remain required for auditability
- local SQLite mode remains useful for development, tests, offline work, and single-agent operation

## D-MEMORY-003: Use PostgreSQL as the primary shared gateway database

Status: accepted

Context:

The common gateway must support multiple developers and agents reading and writing shared project memory. SQLite is excellent for embedded local operation, but it is not the right primary database for a shared concurrent service.

Decision:

Use PostgreSQL as the primary database backend for shared gateway mode. Keep SQLite as an embedded backend for local mode, tests, packaging smoke checks, and offline/single-agent workflows.

Rationale:

PostgreSQL gives the project a durable shared database with strong concurrency, transactions, row-level locking, JSONB, full-text search, migrations, backup/restore tooling, and a clear path to provenance, audit, and permissions. It matches the relational model better than document stores and avoids treating SQLite as a networked team database.

Consequences:

- gateway mode should default to PostgreSQL once implemented
- SQLite support should remain behind a storage abstraction
- repositories should stop depending directly on `better-sqlite3` as a permanent feature-layer detail
- SQL should stay explicit and dialect-aware
- PostgreSQL migrations should be introduced alongside or after the storage boundary
- FTS5 remains SQLite-local; PostgreSQL search should use `tsvector`/`tsquery` or equivalent explicit search tables
- shared deployments need operational settings for database URL, pool size, migration execution, and backups
- auth/permissions can still be staged later, but database choice should not block them
