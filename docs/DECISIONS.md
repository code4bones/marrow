# Project Memory MCP — Decisions

This document records important project decisions until the MCP memory server is used to store its own decisions.

## D-MEMORY-001: MVP is local-first stdio

Status: active

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

## D-MEMORY-002: Design for future collaboration without implementing server sync in MVP

Status: active

Context:

A single project may have multiple developers and agents. Project and common knowledge should be shareable across the team, not trapped in one developer's local database.

Decision:

The MVP remains local-first, but the data model, documentation, IDs, and future feature plan must be collaboration-ready. Collaboration is a near-future capability, not an MVP runtime feature.

Rationale:

Adding remote sync, auth, permissions, or multi-user server mode now would expand the MVP too much. Ignoring collaboration would create design debt around ownership, provenance, conflict handling, and export/import.

Consequences:

- records should keep stable human-readable ids
- future schema should add author/source/provenance fields before remote sync
- project and common knowledge should be exportable/importable
- sync must preserve append-only events
- common knowledge should be shareable across projects and developers
- project-specific knowledge must remain scoped and override common knowledge
- future collaboration should support file-based exchange before networked server sync
