# ARCHITECTURE.md

# Project Memory MCP — Architecture

## Purpose

This repository implements a local-first MCP server for structured project memory.

The server is intended to be used by coding agents such as Codex. It helps agents work across multiple long-lived projects without losing context, repeating failed attempts, or ignoring previous decisions.

The implementation must stay simple, inspectable, reusable, and maintainable.

## Artifact file previews

`ArtifactFilePreview` selects a native viewer by MIME type, preserving the text
renderer and normal download link. HEAD validates file availability/access before
mounting an image/player/PDF viewer. All viewers use authenticated same-origin
URLs; no public Telegram URLs, base64 GraphQL payloads or relaxed CSP are needed.
Changing/closing a record aborts the check and removes the old media element.

`artifact-file-response.ts` serves authorized HEAD/GET after artifactDownload's
normal project checks. Inline disposition requires an explicit flag and passive
MIME allowlist; HTML/SVG stay downloads. Native players use single byte ranges,
with 206/416 responses. UTF-8 filenames use RFC5987; private cache and nosniff
headers apply. Stream errors/disconnects are contained.

## Telegram outgoing message exclusion

Migration 132 introduces a shared `telegram_outgoing_messages` registry. Every
project-bot send (binding, /hash, creation, lifecycle) stores a content SHA-256
fingerprint before remote I/O and the returned chat/message identity afterward.
Ingress excludes known outgoing IDs across all project bots, including channel
auto-forwards and edits, before commands, tag filtering or classification. For
anonymous/channel/automatic-forward updates, a ten-minute fingerprint window also
fences updates racing the API response. A send without a confirmed message ID
retains its fingerprint guard across a longer Telegram outage. Human
replies with their own new message IDs remain eligible. No visible marker or
copy of outbound content is added. Known message IDs survive bot deletion.
`from.is_bot` continues to exclude all other bot messages independently.

## Telegram manual intent and artifacts

A typed, schema-validated inbox `manual_override` snapshots explicit assignees,
title, requester, owner and confirmation time. Queueing is owner/admin-only and
locks project/bot/inbox, validates live membership and source dedup, and advances
the attempt fence. The worker bypasses DeepSeek for this intent, then revalidates
owner/member/chat/bot state under locks before ordinary creation/reply/Telly work.
Concurrent retries and an older model response cannot create a second task.

The receiver persists bounded file metadata independently of hashtag/AI decisions
for human media in bound chats. A media-group anchor shares source identity across
album captions. Files stay waiting until source creation or manual confirmation;
new files replying to a known task/request/Marrow reply become pending immediately.
A separate media worker leases downloads, calls grammY getFile and streams HTTPS
through TELEGRAM_BOT_PROXY with a byte cap outside SQL. Under the project lock it
uses existing artifact.put/link.create, commits artifact/source state atomically
and defers realtime effects. Stable source paths and SHA-256 checks protect retries;
no existing artifact is overwritten with different content. Disabled bots defer,
unbound/deleted sources fail explicitly. Credentials stay out of logs and paths.
File response error/abort listeners are installed before rejecting/draining HTTP
statuses, so late stream errors remain contained. Files reuse normal artifact
storage and access rules. Telly may accept the task
while downloads are pending; task.get/preflight expose this state and guide the
agent to re-read before using linked artifact IDs.

## Agent artifact delivery

`record.download_url` provides the ordinary HTTP path for every record kind and
its directly linked artifact attachments. `downloads.mixin.ts` resolves typed
DTOs through existing membership/common-event/request access rules, exports
Markdown/JSON where no original file exists, and issues a random256bit capability.
Migration142 stores only token hashes, record/format/hash, issuing principal and
five-minute expiry. The public `/artifacts/download/:token/:filename` route
precedes session/OAuth authorization and validates the grant, fresh user role/
membership, record and content hash. Artifact bytes stream from existing storage;
record exports are generated on demand. Expiry/deletion/content changes revoke
access. URL tokens are redacted from application logs and omitted in nginx access
logs. Responses are no-store with no-referrer; HEAD/Range do not consume grants.

The gateway's `artifact.download` service resolves ID/path through existing
membership-protected artifact lookups, then opens a bounded file read and checks
stored size/SHA-256. `artifact-download.ts` maps verified raster MIME/signatures
to native MCP image content, other files to embedded binary resources. The MCP
adapter omits base64 from text/structured metadata in auto mode; explicit base64
mode preserves exact bytes for clients saving files locally. It uses the MCP
call's existing authorization, without exposing server paths as client files or
minting public URLs. HTTP streaming downloads and browser previews remain
available. The text-only built-in AI tool loop excludes binary downloads.

## Telegram lifecycle delivery

Telegram task creation atomically enqueues existing Telly offers for resolved
participants without replacing integration authorship or bypassing Telly identity,
route or acceptance checks. The actor label identifies the project bot.

Task status, completion, reassignment and explicit handoff mutations serialize on
project/task rows, persist events and `telegram_project_bot` integration_outbox
records in one transaction. A separate feedback dispatcher claims rows with
SKIP LOCKED and sends Rich Messages outside SQL transactions. It preserves per-task
event order and frozen Telegram participant references. A positive Bot API rejection
may retry; unknown outcomes and expired sending leases never authorize another
send. Shutdown aborts its requests and awaits completion. Disposable per-request
signals also protect lifecycle replies from accumulating abort listeners.

Handoffs require a current performer or PM, a nonempty completed-work note and
expectedVersion; retries against the just-committed version return the existing
result. Active claims must be completed/released first. No follow-up task or final
completion is implied. CLAR independently requires a question and uses its own
event and role action. Task.get/preflight explain these rules for Telegram tasks.

## Architecture style

Gateway Telegram project bots use a feature-local `telegram-project-bots/`
module: grammY polling supervisor, Bot API/credential helpers, entity parser,
explicit chat binding receiver, per-bot hashtag filter, chat-scoped mention mappings, active-member resolver,
a bounded DeepSeek classifier and durable queue worker. Each bot has a renewable
DB lease, revision and persistent getUpdates offset. Polling uses the existing
TELEGRAM_BOT_PROXY; it resumes on startup and cancels active requests on
disable/remove/shutdown. Offset advancement commits with chat binding or queue
insertion, before Telegram acknowledgement. Bound-chat mentions are remembered before tag
filtering for manual mapping; private/unbound messages never populate mappings. The project management mixin exposes
owner/admin operations through MCP/GraphQL. The Bots activity switch changes
desired state dynamically; computed polling status reports actual connection
health separately. Each bot catches its API/network/unexpected errors; the
supervisor also contains initialization/reconciliation/cleanup failures so they
cannot stop other bots or reject into the gateway lifecycle. The classification worker calls
DeepSeek outside transactions, saves its classification, then rechecks binding
and membership and creates tasks/source links/events atomically using PgToolService.
One task per source message is enforced under the project lock; missing or
unresolved recipients assign it to the owner, while several resolved performers
share one task. Explicit recipient tag routes take priority over mentions. Realtime/Telegram notifications and
the project bot's task reply are deferred until commit. Every grammY polling/reply
request gets a disposable abort signal, avoiding accumulation on the lifetime
polling signal. The global notification
bot remains a separate integration. Contracts and deployment live in
[MCP_TOOLS.md](MCP_TOOLS.md#project-telegram-bots-gateway).

The polling ingress records every newly observed update in a bounded per-bot
journal before task filters, with binding keys redacted. Receive counters,
journal rows, chat binding/queue writes and the cursor commit together; pipeline
completion counters commit with task creation. Owner/admin GraphQL/MCP reads
provide compact journal pages and selected-message details. A successful binding
returns a post-commit Rich Message reply descriptor to the polling loop; sending
it is isolated from binding and cursor persistence.

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

Use explicit SQL behind a storage boundary.

SQLite remains the local embedded backend:

* `better-sqlite3` for synchronous simplicity
* or `sqlite`/`sqlite3` if async is preferred

For MVP, synchronous `better-sqlite3` is acceptable because the MCP server is local-first and runs as a local stdio tool.

PostgreSQL is the primary target for shared gateway mode. A single project can be used by multiple developers and agents, so shared runtime needs a concurrent database, stable IDs, append-only events, future provenance fields, and PostgreSQL-native search.

Feature services should not permanently depend on `better-sqlite3` details. The next architecture step is to introduce a database/repository boundary that can support both:

```text
local stdio mode -> SQLite
shared gateway mode -> PostgreSQL
```

Use simple SQL.

Avoid ORM in MVP.

Reasons:

* schema is small
* SQL should stay inspectable
* dialect differences should be explicit
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

Task assignments use a normalized `task_assignees` relation and batched hydration
for task/record/summary/graph reads, retaining a legacy scalar compatibility
mirror. Each newly added recipient receives its own assignment event/Telly offer;
lifecycle targets include the full set. GitLab exports snapshot/recheck all
recipients and create one issue; imports preserve several mapped participants.
Telegram's bound-chat people collector observes senders/mentions/replies/forwards/
rich content/member events even when no task can be extracted. Per-chat mapped
recipient tag routes, current memberships and bot tags are checked again after
classification; tags route assignees but never bypass AI intent detection.

Telegram recipient observations remain as provenance rows, while `chatRecipients`
aggregates a unique observed numeric ID and its username into one editable person.
Reads and classifier/tag routing use the same grouping; edits/clear update every
alias under the bot lock. Conflicting account mappings fall back to the owner
until explicitly resolved. `/hash` is handled before tag/AI filtering in bound
chats, snapshots current routes, and sends Rich Message feedback only after the
cursor/journal commit. Command menu registration is isolated from polling errors;
its lease is renewed after remote registration before the next getUpdates call.
