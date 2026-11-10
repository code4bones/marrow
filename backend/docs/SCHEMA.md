# SCHEMA.md

## Temporary download grants (gateway migration142)

`download_grants`: token_hash primary key (SHA-256, raw token is never stored),
record_id, export format, issuing user_id/client_id, content sha256, indexed
expires_at. Each row grants a single file for300seconds. Access checks reload the
current record and issuing user's active role/membership; stale content fails.
Expired rows are deleted on new issuance. Polymorphic record IDs are resolved
through typed public DTOs, never raw database exports.

## Shared task assignees

Migration 123 adds canonical `task_assignees(task_id, user_id, position)` with a
composite primary key, user/task cascade FKs and a `(user_id, task_id)` filter
index. Existing `tasks.assignee_user_id` values are backfilled. The legacy column
mirrors the first recipient for compatibility; API reads derive the first from
the relation, including when deletion of a primary user leaves other recipients.
Task assignment updates, events/outbox offers and task writes commit together.

Migration 124 adds `gitlab_issue_exports.recipient_user_ids` and `gitlab_user_ids`
JSON snapshots, backfills earlier operations and preserves legacy scalar fields.
One remote issue carries all mapped assignees; the full recipient set and current
mappings are checked before POST. A partial remote assignment is diagnosed on the
existing issue rather than creating another issue. Migration 125 adds EN/RU UI
labels, task/bot help and routing settings.

## Telegram feedback and CLAR

Migration 129 adds nullable `telegram_task_sources.bot_id` (SET NULL on bot
deletion), `message_thread_id`, a task lookup index and `participants` JSONB.
Bot/thread values backfill from retained inbox records; no old notifications are
generated. Participants map internal user keys to remembered Telegram ID/username/
label references; outgoing payloads freeze those references at each event.

The existing integration_outbox (migration 103) is shared with Telly. The
`telegram_project_bot` consumer handles task.done/clar/handoff/reassigned kinds,
event+source idempotency, source/topic, task version and from/to Telegram snapshots.
Sending leases that expire become `TELEGRAM_FEEDBACK_UNCERTAIN`, not pending.
Migration 130 extends the PostgreSQL task status check with `clar`; 131 adds
English/Russian status/question UI translations. Task DTOs expose `version` for
handoff concurrency fencing.

Migration 132 adds `telegram_outgoing_messages`: UUID, nullable bot FK (SET NULL),
chat/message IDs, SHA-256 content fingerprint and creation time, with identity
and bounded fingerprint lookup indexes. Identity guards apply across project
bots; fingerprints only fence anonymous/channel/automatic-forward messages for
ten minutes around confirmed sends; unresolved sends retain their fingerprint
guard until their identity is known. No outbound content is stored here.

Migrations 133–134 add typed inbox `manual_override` and manual-task UI labels.
The JSON contract has assigneeUserIds, title, requestedBy, ownerUserId and
requestedAt; the normal monotonic attempts field fences in-flight older work.

Migration 135 adds `telegram_media_groups(project_id, chat_id, media_group_id)`
with its canonical task message ID, and `telegram_message_files`: source/bot/chat/
message/file identities, kind/name/MIME/size, album/reply/topic, task/artifact FKs,
waiting/pending/processing/done/failed state, attempts/time/lease/safe error code.
Unique (project, chat, message, file_unique_id) fences receive replay. Pending files
are associated only after a task exists. Artifact writes and task `attached_to`
links commit with file state. Outgoing messages gain nullable task_id so files
replying to a Marrow status reply find the same task. Migration 136 adds file UI
labels. Task.get/preflight expose artifactIds and Telegram attachment state.

Migration 137 adds artifact viewer/download/retry UI translations; file metadata
and storage paths are unchanged.

## Gateway Telegram project bots

Migration `117_project_telegram_bots.cjs` adds:

- `project_telegram_bots`: project FK, globally unique Telegram bot ID, username,
  normalized per-bot hashtag filter list (`filter_tags` JSON array),
  AES-GCM token under `TELEGRAM_BOT_ENC_KEY`, enabled state, persistent polling
  offset, revision UUID, polling owner/lease, rate-limit retry time, polling
  diagnostics/last successful poll, hashed single-use link code/expiry, safe
  classification diagnostics and last receipt metadata.
- `project_telegram_chats`: `(bot_id, chat_id)` primary key, title and creation
  time. Multiple bots per project and multiple bindings per bot; bot deletion cascades.
- `telegram_message_inbox`: unique `(project_id, chat_id, message_id)`, normalized
  message snapshot, persisted classification/owner, pending/processing/done/ignored/failed
  state, attempt count, retry time/lease and diagnostic code. Bot/project deletion cascades.
- `telegram_task_sources`: `(project_id, chat_id, message_id, telegram_user_id)`
  primary key and nullable task FK (`ON DELETE SET NULL`). Tombstones survive bot
  and task deletion, preventing recreation of already processed assignments.

Migration 118 adds the English/Russian Bots UI translations.

Migration `119_telegram_bot_messages.cjs` adds lifetime receive/match/process
counters and latest-match/process timestamps to bots; classification/completion
timestamps and result reason to the inbox; and `telegram_bot_messages`, a bounded
receive journal with unique `(bot_id, telegram_update_id)`, chat/message metadata,
redacted text, filter results and nullable inbox FK. The latest 500 entries per
bot are retained independently of lifetime counters. Journal/counters/cursor
commit atomically; pipeline completion/counters commit with tasks. Migration 120
adds table/history/detail translations. No Telegram bot token or binding key is
stored in the journal.

Migration `121_telegram_chat_mentions.cjs` adds `telegram_chat_mentions`, keyed by
`(bot_id, chat_id, mention_key)`: normalized username/Telegram ID, display label,
last-seen timestamp and optional mapped user FK. The composite FK cascades on
chat unlink/bot removal; user deletion clears the manual assignment. Runtime
checks restrict assignments to active project members and the active owner.
Migration 122 adds EN/RU chat-recipient settings. Only new bound-chat mentions are
collected; existing messages are not reprocessed. New task source rows use the
`telegram_user_id = 'message'` marker; source lookup checks the whole project/chat/
message under a project lock, including older per-recipient tombstones.

Migration 126 adds observed-person `username` aliases and `source_type` to
`telegram_chat_mentions`. Numeric keys preserve manual mappings on username changes.
Migration 127 adds `assignment_tags` (JSON array) for chat-local routing to a mapped
active participant. Only currently configured bot tags can route tasks; clearing
the account mapping clears its tags. These rows retain known people independent
of the latest-500 message-body journal. Previous author identities cannot be
backfilled from message bodies, which did not preserve senders.

Migration 128 adds EN/RU command-result and conflicting-recipient labels. Recipient
alias consolidation is a computed view over existing observation rows; it retains
provenance and updates mappings/tags of all known aliases atomically.

## Gateway project GitLab settings

Migration `112_gitlab_issue_exports.cjs` adds `gitlab_issue_exports`: a unique nullable task FK (`ON DELETE SET NULL`), original task ID, project FK, optional repository FK, retained explicit repository choice, repository host/numeric project ID/URL snapshot, assigning/recipient identities, GitLab assignee, lifecycle (`pending`, `processing`, `uncertain`, `blocked`, `failed`, `done`, `cancelled`), POST-attempt timestamp, retry lease and safe diagnostic code. The operation UUID is the issue-description correlation marker; no token is copied into the operation. Assignment and intent commit atomically. A committed POST-attempt flag forbids blind re-creation after process death or lost response. `gitlab_issue_links` is shared by import and export. Export tombstones persist after task/repository removal for late webhook correlation.

Migration `110_project_repository_lead.cjs` adds nullable `project_repositories.lead_user_id` referencing `users(id) ON DELETE SET NULL`. It identifies one lead developer, without granting permissions. Setting a lead requires an active project member or owner; membership removal clears the field in the same transaction. Import checks active membership and user status again before using the lead for issues without assignees.

Migration `106_project_gitlab_settings.cjs` adds:

- `project_repositories`: UUID `id`, `project_id`, normalized GitLab `host`, numeric `gitlab_project_id` stored as text, canonical `path`, `name`, `web_url`, `created_by`, `created_at`. Unique `(project_id, host, gitlab_project_id)`; project deletion cascades to these rows. Multiple repositories and multiple hosts may belong to one Marrow project.
- `project_gitlab_members`: `(project_id, user_id, host)` primary key, `gitlab_user_id` stored as text, display snapshots `username`/`name`, and `updated_at`. Unique `(project_id, host, gitlab_user_id)` prevents ambiguous recipients. Project/user deletion cascades; membership removal explicitly clears mappings in the same transaction. Membership and role remain independent of GitLab identity.

Detaching a repository preserves member mappings, so reattaching a repository on the same host retains configured recipients. New mappings/searches require an attached repository on that host. These configuration tables contain no tokens.

Migration `108_gitlab_issue_inbox.cjs` adds `gitlab_webhooks` (repository FK, remote hook ID, auth mode, encrypted per-repository secret and enabled state), `gitlab_issue_inbox` (bounded normalized issue snapshots, unique repository/delivery key, pending/processing/done/ignored/failed lifecycle, lease, attempts and diagnostics), and `gitlab_issue_links` (unique project/host/GitLab-project/issue provenance, task FK `ON DELETE SET NULL`). Links survive repository detachment and act as tombstones after task deletion. The worker atomically creates task/link/events and marks delivery done, with deferred post-commit notifications. Failed deliveries retry up to eight attempts before requiring an explicit retry.

# Project Memory MCP — Database Schema

## Storage

Local mode uses SQLite.

Default local database path:

```text
.agent/project-memory.sqlite
```

Configurable with:

```text
PROJECT_MEMORY_DB=/path/to/project-memory.sqlite
```

Shared gateway mode uses PostgreSQL through `POSTGRES_*` connection variables.

SQLite and PostgreSQL schemas should preserve the same logical model even when search implementation differs.

## Schema principles

The schema should be:

* simple
* inspectable
* migration-based
* local-first
* friendly to agents and humans
* strict enough to prevent garbage records
* flexible enough to support many project types

## Common records

Common knowledge is represented by records with:

```text
project_id = NULL
```

Project-specific records have:

```text
project_id = <project id>
```

Default search should include both:

```text
project_id = current project
OR project_id IS NULL
```

## Tables overview

Core MVP tables:

* `projects`
* `items`
* `tasks`
* `task_claims`
* `decisions`
* `links`
* `events`
* `artifacts`
* `migrations`
* `kv`

Gateway tables:

* `gateway_clients`
* `sync_conflicts`

Artifact bytes are stored on the gateway filesystem under `ARTIFACT_DIR`; PostgreSQL stores artifact metadata and search indexes.

Search tables:

* `items_fts`
* optional FTS tables for tasks/decisions later

## `projects`

Stores durable project contexts.

The `P-` prefix is reserved for IDs, case-insensitively; it is forbidden in
`slug` on insert and rename. Use `frappe-cicd` as a slug. PostgreSQL enforces
`projects_slug_not_project_id` (migration 144); SQLite enforces insert/update
triggers (migration 004). Existing artifact files keep their stored paths.

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  root_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Allowed statuses:

```text
active
paused
archived
```

Example:

```text
id: P-MEMORY
slug: project-memory-mcp
title: Project Memory MCP
status: active
```

## `items`

Stores generic typed memory records.

```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'current',
  tags TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

`project_id` is nullable.

If `project_id` is null, the item is common knowledge.

### Suggested item statuses

```text
current
draft
archived
superseded
rejected
```

### Suggested item types

```text
agent_rule
workflow_rule
note
feature
pattern
snippet
entity
failed_attempt
research_note
glossary_term
prompt_template
accessibility_rule
architecture_note
```

The type list is extensible.

### Tags

Tags are stored as JSON array text in MVP.

Example:

```json
["common", "agent", "workflow"]
```

Use helper functions to parse and serialize tags.

Do not store comma-separated tags if JSON helpers already exist.

## `items_fts`

FTS5 table for item search.

```sql
CREATE VIRTUAL TABLE items_fts USING fts5(
  id UNINDEXED,
  title,
  body,
  tags,
  type UNINDEXED,
  status UNINDEXED,
  project_id UNINDEXED
);
```

Use triggers to keep `items_fts` synchronized.

```sql
CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(id, title, body, tags, type, status, project_id)
  VALUES (new.id, new.title, new.body, new.tags, new.type, new.status, new.project_id);
END;

CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
  DELETE FROM items_fts WHERE id = old.id;
END;

CREATE TRIGGER items_au AFTER UPDATE ON items BEGIN
  DELETE FROM items_fts WHERE id = old.id;
  INSERT INTO items_fts(id, title, body, tags, type, status, project_id)
  VALUES (new.id, new.title, new.body, new.tags, new.type, new.status, new.project_id);
END;
```

## `tasks`

Stores executable agent tasks.

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  milestone TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  scope TEXT,
  acceptance TEXT,
  allowed_files TEXT,
  forbidden_files TEXT,
  depends_on TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

Allowed statuses:

```text
todo
doing
blocked
clar
review
changes_requested
done
cancelled
```

### JSON fields

These fields should be stored as JSON array text:

```text
allowed_files
forbidden_files
depends_on
```

Examples:

```json
["src/features/tasks/**", "docs/SCHEMA.md"]
```

```json
["src/features/projects/**"]
```

### Task ordering

`task.next` should use:

1. status `todo`
2. lowest priority number first
3. oldest `created_at` first

## `task_claims`

Stores collaborative task leases. A claim means one agent is actively working
on a part of a task; it is not ownership of the whole task.

```sql
CREATE TABLE task_claims (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_label TEXT,
  client_kind TEXT,
  role TEXT NOT NULL DEFAULT 'other',
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  lease_expires_at TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

Allowed statuses:

```text
active
released
completed
expired
cancelled
```

Allowed roles:

```text
backend
frontend
test
docs
review
devops
coordination
other
```

Agents do not need to know their own permanent identifier. `task.claim` returns
`claim.id`, and subsequent heartbeat/complete/release calls use that claim id.
`client_id` is recorded from gateway request context when available.

Tasks are not automatically closed when active claim count reaches zero.
Closing a task is an explicit `task.complete` operation and is refused while
other active claims exist unless `force=true` is supplied with a reason or
acceptance evidence.

## `decisions`

Stores architectural, product, workflow, and project decisions.

```sql
CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'accepted',
  context TEXT,
  decision TEXT NOT NULL,
  rationale TEXT,
  consequences TEXT,
  tags TEXT,
  supersedes_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (supersedes_id) REFERENCES decisions(id)
);
```

`project_id` is nullable.

If `project_id` is null, the decision is common.

Allowed statuses:

```text
draft
accepted
superseded
rejected
archived
```

### Project override rule

Project-specific decisions override common decisions when they conflict.

The database does not need to enforce this automatically in MVP. Preflight should present both and clearly mark project decisions.

## `links`

Stores lightweight graph relationships.

```sql
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

Examples of relations:

```text
depends_on
relates_to
supersedes
implements
warns_against
belongs_to
blocks
references
```

The linked records may come from different tables.

The MVP does not need polymorphic foreign keys. Validate linked IDs at service level when practical.

## `events`

Stores append-only timeline events.

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  type TEXT NOT NULL,
  title TEXT,
  body TEXT,
  related_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

Events should not be casually updated.

Event examples:

```text
project.created
project.updated
project.deleted
task.created
task.started
task.completed
task.blocked
task.claimed
task.claim_completed
task.claim_released
task.note_added
decision.recorded
attempt.failed
item.created
artifact.created
artifact.updated
artifact.metadata_updated
artifact.archived
migration.applied
```

## `artifacts`

Stores metadata for shared files. File bytes live on the gateway filesystem under
`ARTIFACT_DIR`.

```sql
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  path TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'current',
  archived_at TEXT,
  archived_by TEXT,
  archive_reason TEXT,
  tags JSONB NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
```

Allowed statuses:

```text
current
archived
```

Artifact path is unique inside project/common scope:

```text
coalesce(project_id, '__common__') + path
```

Default artifact search should return only current artifacts. Archived artifacts
remain retrievable by explicit id/path and can be searched when requested.

## `kv`

Stores small configuration values.

```sql
CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Initial possible keys:

```text
current_project_id
schema_version
```

If current project is stored in the database, use `kv.current_project_id`.

If current project is supplied by environment variable, environment should override database config.

## `migrations`

Tracks applied migrations.

```sql
CREATE TABLE migrations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

## Initial migration

`migrations/001_init.sql` should create:

* `projects`
* `items`
* `items_fts`
* item FTS triggers
* `tasks`
* `decisions`
* `links`
* `events`
* `kv`
* `migrations`

## Indexes

Recommended indexes:

```sql
CREATE INDEX idx_projects_slug ON projects(slug);

CREATE INDEX idx_items_project_id ON items(project_id);
CREATE INDEX idx_items_type ON items(type);
CREATE INDEX idx_items_status ON items(status);

CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);

CREATE INDEX idx_decisions_project_id ON decisions(project_id);
CREATE INDEX idx_decisions_status ON decisions(status);

CREATE INDEX idx_events_project_id ON events(project_id);
CREATE INDEX idx_events_related_id ON events(related_id);
CREATE INDEX idx_events_created_at ON events(created_at);

CREATE INDEX idx_links_from_id ON links(from_id);
CREATE INDEX idx_links_to_id ON links(to_id);

CREATE INDEX idx_artifacts_project_id ON artifacts(project_id);
CREATE INDEX idx_artifacts_status ON artifacts(status);
CREATE INDEX idx_artifacts_created_at ON artifacts(created_at);
```

## ID conventions

Prefer human-readable IDs.

Project IDs:

```text
P-MEMORY
P-ECHO
P-WB
```

Common IDs:

```text
C-AGENT-001
C-TASK-001
C-GODOT-001
```

Task IDs:

```text
T-MEMORY-001
T-ECHO-001
```

Decision IDs:

```text
D-MEMORY-001
D-ECHO-001
```

Item IDs:

```text
I-MEMORY-001
I-ECHO-LORE-001
```

Event IDs:

```text
E-MEMORY-001
```

MVP may implement simple sequential ID generation.

Do not block MVP on perfect ID generation.

## Required seed data

The initial seed should create the current project:

```text
P-MEMORY
slug: project-memory-mcp
title: Project Memory MCP
```

And common records:

```text
C-AGENT-001 Always run preflight before task execution
C-AGENT-002 Keep diffs small and reviewable
C-AGENT-003 Do not expand scope without explicit request
C-AGENT-004 Record failed attempts
C-TASK-001 Every task needs acceptance criteria
C-TASK-002 Allowed and forbidden files should be explicit when possible
C-ARCH-001 Prefer feature-oriented architecture
C-ARCH-002 Shared code must be genuinely reusable
```

## Search query behavior

Search should find records where:

```sql
items.project_id = :project_id OR items.project_id IS NULL
```

unless explicitly configured otherwise.

Default limit:

```text
10
```

Search output should identify whether a record is:

```text
project
common
```

## PostgreSQL Gateway Schema

The shared gateway uses PostgreSQL as the primary database.

Logical tables remain:

* `projects`
* `items`
* `tasks`
* `decisions`
* `links`
* `events`
* `kv`
* `migrations`

PostgreSQL-specific additions include:

* `jsonb` for JSON array/object fields where useful
* `tsvector` search columns or dedicated search indexes for memory search
* row versioning fields for conflict detection
* provenance fields for shared use
* indexes for project/status/type/tag filters
* `gateway_clients` for recently seen MCP gateway clients
* `sync_conflicts` reserved for future conflict reporting

SQLite FTS5 should remain a local-mode implementation detail, not the shared gateway search design.

### Gateway provenance fields

PostgreSQL core record tables include provenance fields where practical:

```text
created_by
updated_by
source_instance_id
version
```

MCP HTTP clients send:

```text
x-project-memory-client-id
x-project-memory-client-label
x-project-memory-client-kind
```

The gateway stores the client id in provenance fields and records automatic events with the same source.

### `gateway_clients`

Stores recently seen gateway clients.

```sql
CREATE TABLE gateway_clients (
  id TEXT PRIMARY KEY,
  label TEXT,
  last_seen_at TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

This table is updated when a client calls a gateway tool. It is exposed through `gateway.clients`.

### `sync_conflicts`

Reserved for future explicit conflict detection and resolution.

```sql
CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY,
  record_table TEXT NOT NULL,
  record_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  local_record JSONB,
  incoming_record JSONB,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);
```

## Future schema additions

Do not implement in MVP unless requested:

* embeddings table
* file references table
* markdown export table
* git commits table
* source/import fields such as `source`, `imported_at`
* import/export tracking tables
* users table
* remote sync table
* permissions table
* graph visualization metadata

## Schema Definition of Done

The schema is acceptable when:

* all MVP tables exist
* migrations are reproducible
* FTS search works for `items`
* project records and common records are distinguishable
* project + common search works
* task lifecycle can be represented
* decision records can supersede older decisions
* events can record history
* links can connect arbitrary records
* the database is inspectable with standard SQLite tools
