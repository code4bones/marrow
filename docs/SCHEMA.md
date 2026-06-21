# SCHEMA.md

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
  status TEXT NOT NULL DEFAULT 'active',
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
active
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

## `decisions`

Stores architectural, product, workflow, and project decisions.

```sql
CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
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
active
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
task.created
task.started
task.completed
task.blocked
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
  status TEXT NOT NULL DEFAULT 'active',
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
active
archived
```

Artifact path is unique inside project/common scope:

```text
coalesce(project_id, '__common__') + path
```

Default artifact search should return only active artifacts. Archived artifacts
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
