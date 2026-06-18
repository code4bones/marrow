# Project Memory MCP — Implementation Status

This document records what has been implemented so far and what remains after the first MVP implementation pass.

## Implemented Scope

The repository now contains a working local-first TypeScript MCP server with SQLite persistence.

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
- tests, typecheck, lint, and build scripts

The implementation intentionally does not include UI, auth, remote sync, cloud dependencies, embeddings, vector search, or multi-user collaboration.

## Runtime Stack

- Node.js
- TypeScript
- MCP SDK
- SQLite through `better-sqlite3`
- SQLite FTS5
- Zod for runtime validation
- Vitest for tests
- ESLint for linting

## Source Layout

The code follows the feature-oriented structure described in `docs/ARCHITECTURE.md`.

```text
src/
  app/
    bootstrap.ts
    config.ts

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

## MCP Tools

Implemented tools:

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

Tool handlers validate inputs with Zod, call services, and return structured success/error payloads.

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

## Validation

Current validation commands:

```bash
npm run lint
npm run typecheck
npm test
npm run smoke
npm run build
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

- exercise the server in a real MCP client configuration
- include linked records in `preflight`
- include task dependencies in richer form
- add Markdown export snapshots under `docs/generated/`
- add import from structured Markdown
- add dedicated FTS support for tasks and decisions if needed
- improve ID generation beyond simple sequential prefixes
- add more tests around error cases and edge cases
- document MCP client configuration examples

## Recommended Next Step

Exercise the built server in a real MCP client configuration and verify that the client can list and call the implemented tools.
