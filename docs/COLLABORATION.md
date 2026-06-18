# Project Memory MCP — Collaboration Readiness

This document describes how Project Memory MCP should evolve toward team collaboration while preserving the MVP's local-first model.

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

## MVP Boundary

The current MVP does not implement:

- remote server mode
- auth
- permissions
- cloud sync
- multi-user runtime collaboration
- conflict resolution service

This boundary remains valid.

However, the MVP must not make collaboration hard to add later.

## Collaboration-Ready Principles

### 1. Local-first remains the base

Every developer should be able to run the MCP server locally with SQLite.

Collaboration should add exchange/sync paths, not replace local operation.

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

### 6. Provenance should be added before network sync

Before remote sync, records should gain provenance fields or metadata.

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

### Phase 1: Markdown/JSON export and import

Add local file exchange first.

Capabilities:

- export project memory snapshot
- export common knowledge snapshot
- import reviewed snapshot
- detect duplicate IDs
- preserve events
- record import/export events

Suggested files:

```text
docs/generated/PROJECTS.md
docs/generated/TASKS.md
docs/generated/DECISIONS.md
docs/generated/COMMON_RULES.md
memory-export/project-memory.json
memory-export/common.json
```

Why first:

- works with Git
- reviewable in pull requests
- no auth required
- no always-on server required
- supports teams before network sync exists

### Phase 2: Shared repository workflow

Allow a project to keep memory snapshots in its Git repository.

Typical workflow:

```text
agent exports memory snapshot
developer reviews diff
snapshot is committed
another developer imports snapshot
```

This gives collaboration through Git without adding a hosted service.

### Phase 3: Optional sync backend

Only after export/import is stable, consider a sync backend.

Possible options:

- shared SQLite file on a trusted local network
- HTTP/SSE MCP server mode
- small sync service with auth
- Git-backed sync

Do not add this until there is a concrete operational need.

### Phase 4: Multi-user server mode

Add this only if teams need a shared live server.

Required before this phase:

- auth model
- permissions
- conflict handling
- backup/restore story
- migration compatibility
- audit events

## Conflict Handling Direction

MVP should not solve conflicts automatically.

Future import/sync should detect:

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

Future tools may include:

```text
memory.export
memory.import
common.export
common.import
sync.preview
sync.apply
sync.conflicts
sync.resolve
```

These should not replace the current tools. They should sit around the existing project/memory/task/decision/event/link model.

## Current Practical Rule

For now, treat collaboration as a design constraint:

- keep records typed
- keep IDs stable
- keep docs human-readable
- keep events append-only
- avoid hidden local-only assumptions
- prefer export/import before remote sync
