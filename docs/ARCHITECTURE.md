# ARCHITECTURE.md

# Project Memory MCP — Architecture

## Purpose

This repository implements a local-first MCP server for structured project memory.

The server is intended to be used by coding agents such as Codex. It helps agents work across multiple long-lived projects without losing context, repeating failed attempts, or ignoring previous decisions.

The implementation must stay simple, inspectable, reusable, and maintainable.

## Architecture style

Use a feature-oriented architecture inspired by FSD principles.

This is not a frontend application, so do not copy FSD mechanically. Instead, apply the core ideas:

* split code by business capability
* isolate reusable shared code
* keep public APIs explicit
* avoid circular dependencies
* avoid god objects
* keep modules small
* make dependencies flow in one direction
* prefer clear contracts over implicit coupling
* make features independently understandable
* keep infrastructure separate from business logic

## Proposed source layout

```text
src/
  app/
    server.ts
    config.ts
    bootstrap.ts

  features/
    projects/
      model/
        types.ts
        schema.ts
      service/
        project.service.ts
      repo/
        project.repo.ts
      mcp/
        project.tools.ts

    memory/
      model/
        types.ts
        schema.ts
      service/
        memory.service.ts
        search.service.ts
      repo/
        memory.repo.ts
      mcp/
        memory.tools.ts

    tasks/
      model/
        types.ts
        schema.ts
      service/
        task.service.ts
      repo/
        task.repo.ts
      mcp/
        task.tools.ts

    decisions/
      model/
        types.ts
        schema.ts
      service/
        decision.service.ts
      repo/
        decision.repo.ts
      mcp/
        decision.tools.ts

    events/
      model/
        types.ts
        schema.ts
      service/
        event.service.ts
      repo/
        event.repo.ts
      mcp/
        event.tools.ts

    links/
      model/
        types.ts
        schema.ts
      service/
        link.service.ts
      repo/
        link.repo.ts
      mcp/
        link.tools.ts

    preflight/
      model/
        types.ts
      service/
        preflight.service.ts
      mcp/
        preflight.tools.ts

  shared/
    db/
      connection.ts
      migrations.ts
      transaction.ts
      schema.sql

    ids/
      id.service.ts

    validation/
      errors.ts
      result.ts
      zod.ts

    mcp/
      register-tools.ts
      tool-response.ts

    logging/
      logger.ts

    utils/
      dates.ts
      json.ts
      strings.ts

  scripts/
    seed-common.ts
    seed-demo.ts
```

## Layer meaning

### `app/`

Application composition layer.

Responsibilities:

* load config
* open database connection
* run migrations
* create MCP server
* register feature tools
* start server

The `app` layer wires modules together but should not contain business logic.

### `features/`

Business capability modules.

Each feature owns:

* its model types
* validation schema
* repository
* service
* MCP tool registration

Feature modules should expose small public functions.

A feature should not reach into another feature’s internal files.

Allowed cross-feature communication should happen through service APIs.

### `shared/`

Reusable infrastructure and utility code.

Allowed contents:

* database connection
* migrations
* ID generation
* validation helpers
* MCP response helpers
* logger
* date helpers
* JSON helpers
* generic result/error helpers

Shared code must not contain project-memory business rules unless those rules are truly global infrastructure.

## Dependency direction

Preferred dependency flow:

```text
app
  -> features
    -> shared
```

Feature-to-feature dependencies should be limited and explicit.

Example of allowed coordination:

```text
preflight.service
  -> task.service
  -> project.service
  -> decision.service
  -> memory.service
  -> event.service
```

Avoid:

```text
task.repo imports preflight.service
memory.repo imports task.service
shared imports features
```

`shared` must never import from `features`.

## Feature module structure

Each feature should follow this shape when practical:

```text
features/<feature>/
  model/
    types.ts
    schema.ts
  repo/
    <feature>.repo.ts
  service/
    <feature>.service.ts
  mcp/
    <feature>.tools.ts
```

### `model/types.ts`

TypeScript domain types.

Example:

```ts
export type ProjectStatus = "active" | "paused" | "archived";

export interface Project {
  id: string;
  slug: string;
  title: string;
  description?: string;
  status: ProjectStatus;
  rootPath?: string;
  createdAt: string;
  updatedAt: string;
}
```

### `model/schema.ts`

Runtime validation.

Prefer Zod or another small validation library.

Validation should be explicit and close to the feature.

### `repo/*.repo.ts`

Database access only.

Repository methods should:

* run SQL
* map rows to domain objects
* avoid business decisions
* avoid MCP-specific formatting
* avoid validation of tool input
* avoid calling other feature services

### `service/*.service.ts`

Business behavior.

Services should:

* validate higher-level rules
* call repositories
* record events when needed
* enforce status transitions
* coordinate with other services through public APIs
* provide stable methods for MCP handlers

### `mcp/*.tools.ts`

MCP tool definitions and handlers.

MCP handlers should:

* parse input
* validate input shape
* call services
* return structured output
* avoid direct SQL
* avoid business logic beyond input/output mapping

## Reusability rules

Prefer reusable primitives where they reduce duplication without hiding intent.

Good reusable pieces:

* `createToolResponse`
* `parseJsonArrayField`
* `serializeJsonArrayField`
* `nowIso`
* `createReadableId`
* `withTransaction`
* `assertProjectExists`
* `mapSqliteRow`
* typed error helpers
* result helpers

Bad reusable pieces:

* giant `BaseService`
* giant `BaseRepository`
* abstract class hierarchy for simple CRUD
* generic magical query builders that hide SQL
* one `MemoryManager` that knows everything
* one `utils.ts` dumping ground

Small boring utilities are better than clever abstractions.

## Data access approach

Use SQLite directly.

Recommended library options:

* `better-sqlite3` for synchronous simplicity
* or `sqlite`/`sqlite3` if async is preferred

For MVP, synchronous `better-sqlite3` is acceptable because the MCP server is local-first and runs as a local stdio tool.

The data model should still be collaboration-ready. A single project may eventually be used by multiple developers and agents, so records should keep stable IDs, append-only events, and future-compatible provenance/sync paths. Do not add remote sync or auth in the MVP, but avoid local-only assumptions that would make export/import or later sync difficult.

Use simple SQL.

Avoid ORM in MVP.

Reasons:

* schema is small
* SQL should stay inspectable
* fewer dependencies
* easier debugging
* easier migrations
* easier for agents to understand

## Migrations

Use checked-in SQL migrations.

Example:

```text
migrations/
  001_init.sql
  002_add_current_project.sql
```

Migration runner responsibilities:

* create migrations table if missing
* detect applied migrations
* apply pending migrations in order
* record applied migration timestamp
* fail loudly on migration error

Do not silently modify schema at runtime outside migrations.

## Configuration

Support config through environment variables.

Initial variables:

```text
PROJECT_MEMORY_DB=.agent/project-memory.sqlite
PROJECT_MEMORY_CURRENT_PROJECT=
PROJECT_MEMORY_LOG_LEVEL=info
```

The DB path must be configurable.

If `PROJECT_MEMORY_DB` is not set, use a safe local default.

## Current project

The server should support a current project concept.

MVP options:

1. environment variable
2. local config table
3. explicit project parameter for every tool

Preferred MVP behavior:

* tools accept optional `project`
* if missing, use stored current project
* if environment variable is set, it overrides stored current project
* if no current project exists and the tool requires one, return a clear error

The current project should never be guessed.

## Error handling

Use explicit errors.

Errors should include:

* code
* message
* optional details

Example codes:

```text
PROJECT_NOT_FOUND
TASK_NOT_FOUND
ITEM_NOT_FOUND
DECISION_NOT_FOUND
INVALID_STATUS
VALIDATION_ERROR
CURRENT_PROJECT_NOT_SET
DB_ERROR
```

Avoid returning raw stack traces through MCP.

Log details locally, return clean messages to the agent.

## Validation philosophy

Validate at the boundary.

MCP tool input must be validated before reaching services.

Services should still validate important invariants.

Repositories should assume valid data but must handle database errors.

## MCP response style

MCP tool responses should be structured and easy for agents to read.

Success:

```json
{
  "ok": true,
  "summary": "Task T-MEMORY-001 created.",
  "data": {}
}
```

Error:

```json
{
  "ok": false,
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task T-MEMORY-999 does not exist."
  }
}
```

## Search architecture

Search should use SQLite FTS5.

Search service should support:

* query text
* project id or slug
* include common
* type filter
* status filter
* limit

Default search scope:

```text
current project + common
```

Ranking rule:

```text
project-specific results before common results
```

Search results should include:

* id
* type
* title
* body excerpt
* status
* tags
* project slug or `common`
* score/rank if available

## Preflight architecture

Preflight is a feature, not a utility.

It coordinates several features:

* projects
* tasks
* decisions
* memory items
* events
* links

Preflight input:

* task id
* include common flag
* optional limit settings

Preflight output:

* project summary
* task summary
* acceptance criteria
* allowed files
* forbidden files
* dependencies
* relevant project decisions
* relevant common rules
* related items
* known failed attempts
* recent events

Preflight should be deterministic and compact.

The output should be optimized for agent execution.

Preflight is the main guardrail against:

* scope creep
* repeated failed attempts
* ignored decisions
* accidental unrelated edits
* missing acceptance criteria

## Event recording

Some operations should automatically record events.

Examples:

* project created
* task created
* task status changed
* decision recorded
* failed attempt recorded
* item created
* item updated

Do not record noisy events for every read operation.

Events should be append-only by default.

## Testing strategy

MVP test priority:

1. database migrations
2. project creation
3. common record creation/search
4. task lifecycle
5. decision recording
6. event recording
7. preflight output
8. MCP tool handlers with mocked services if practical

Use small tests.

Avoid overengineering the test setup.

## Code quality rules

Use TypeScript strict mode.

Prefer:

* clear names
* small files
* explicit exports
* feature-local types
* plain SQL
* readable validation
* no hidden mutable global state except controlled config/current project
* reusable helper functions where useful
* explicit contracts between layers
* small commits / small diffs

Avoid:

* files over 300-400 lines unless justified
* circular imports
* massive service classes
* magic strings without constants
* broad `any`
* unrelated refactors during feature work
* premature abstractions
* hidden side effects
* business logic in repositories
* SQL in MCP tool handlers

## MVP implementation order

Recommended order:

1. Project bootstrap
2. SQLite connection and migrations
3. Projects feature
4. Items/memory feature
5. FTS5 search
6. Tasks feature
7. Decisions feature
8. Events feature
9. Links feature
10. Preflight feature
11. Seed common records
12. MCP tool registration
13. README usage examples

## Definition of Done for architecture

The architecture is acceptable when:

* features are separated by domain
* shared code is actually shared
* MCP handlers do not contain SQL
* repositories do not contain MCP formatting
* services do not parse raw MCP input
* migrations are explicit
* project + common search works
* preflight can combine context across features
* a new feature can be added without editing one giant central file
* common code is reusable without becoming a dumping ground
* the project remains understandable to a future coding agent
