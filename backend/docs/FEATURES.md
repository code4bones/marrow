# FEATURES.md

# Project Memory MCP — Features

This document describes the intended feature set for the Project Memory MCP server.

The project is split into MVP features, near-future features, and explicitly deferred features.

## MVP features

### F-001: Project registry

The server must support multiple projects.

Each project should have:

* id
* slug
* title
* description
* status
* root path
* created timestamp
* updated timestamp

Required operations:

* create project
* list projects
* get project by slug or id
* set current project
* read current project

Purpose:

Agents need to know which project they are working on before searching or writing memory.

---

### F-002: Common knowledge layer

The server must support records that are not tied to a specific project.

These records represent common reusable knowledge.

Examples:

* agent rules
* coding patterns
* workflow rules
* prompt templates
* common snippets
* generic architecture patterns

Implementation rule:

For MVP, common records may use:

```text
project_id = NULL
```

Search should include common records by default when a current project is selected.

---

### F-003: Typed memory items

The server must support generic typed records.

Required fields:

* id
* project id, nullable for common
* type
* title
* body
* status
* tags
* created timestamp
* updated timestamp

Initial item types:

* `agent_rule`
* `workflow_rule`
* `note`
* `feature`
* `pattern`
* `snippet`
* `entity`
* `failed_attempt`
* `research_note`
* `glossary_term`
* `prompt_template`

The type list should be extensible.

Purpose:

Typed items allow the memory to be flexible without creating a new table for every domain concept.

---

### F-004: Tasks

Tasks are first-class records.

Required fields:

* id
* project id
* title
* status
* milestone
* priority
* scope
* acceptance criteria
* allowed files
* forbidden files
* dependencies
* notes
* created timestamp
* updated timestamp

Task statuses:

* `todo`
* `doing`
* `blocked`
* `done`
* `cancelled`

Required operations:

* create task
* list tasks
* get task
* get next task
* update task status

Purpose:

Agents need structured tasks with explicit scope and Definition of Done.

---

### F-005: Decisions

Decisions are first-class records.

Required fields:

* id
* project id, nullable for common
* title
* status
* context
* decision
* rationale
* consequences
* tags
* supersedes id
* created timestamp
* updated timestamp

Decision statuses:

* `draft`
* `current`
* `superseded`
* `rejected`
* `archived`

Required operations:

* record decision
* list decisions
* get decision
* search decisions
* archive decision
* delete decision after explicit confirmation

Purpose:

Agents need to respect prior architectural and product decisions.

---

### F-006: Events

Events are append-only timeline records.

Required fields:

* id
* project id, nullable
* type
* title
* body
* related id
* created timestamp

Event examples:

* `project.created`
* `task.created`
* `task.started`
* `task.completed`
* `decision.recorded`
* `attempt.failed`
* `migration.applied`

Required operations:

* record event
* list events for project
* list events related to record

Purpose:

Events create a durable project history.

---

### F-007: Links

The server must support links between records.

Required fields:

* from id
* to id
* relation
* project id, nullable

Example relations:

* `depends_on`
* `relates_to`
* `supersedes`
* `implements`
* `warns_against`
* `belongs_to`
* `blocks`

Purpose:

Links allow lightweight graph behavior without requiring a graph database.

---

### F-008: Search

The server must provide search across memory records.

MVP search should use SQLite FTS5.

Search inputs:

* query
* project slug or id
* include common flag
* type filter
* status filter
* limit

Default behavior:

```text
search current project + common
```

Ranking rule:

```text
project-specific results should rank above common results
```

Purpose:

Agents need a reliable way to retrieve relevant memory without scanning all docs manually.

---

### F-009: Preflight

Preflight is the key agent workflow.

Given a task id, the server should return a compact execution context.

Preflight should include:

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
* recent relevant events

Purpose:

Preflight prevents agents from starting work without context.

This should be treated as the most important MVP feature.

---

### F-010: Seed common rules

The repository should include a script that seeds useful common records.

Initial common records:

* `C-AGENT-001: Always run preflight before task execution`
* `C-AGENT-002: Keep diffs small and reviewable`
* `C-AGENT-003: Do not expand scope without explicit request`
* `C-AGENT-004: Record failed attempts`
* `C-TASK-001: Every task needs acceptance criteria`
* `C-TASK-002: Allowed and forbidden files should be explicit when possible`

Purpose:

The MCP should be useful immediately after setup.

---

### F-011: Local-first SQLite persistence

The server must persist data locally in SQLite.

Required behavior:

* create database if missing
* run migrations
* store database path through config or environment
* avoid cloud dependencies

Suggested environment variable:

```text
PROJECT_MEMORY_DB=/path/to/project-memory.sqlite
```

Purpose:

The memory should be portable, inspectable, and private.

---

### F-012: Basic validation

The implementation should validate inputs.

Validation should catch:

* missing required fields
* invalid statuses
* unknown project ids
* invalid task ids
* invalid relation records
* unsafe empty writes

Purpose:

Bad memory records make agents worse, not better.

---

## Near-future features

### NF-001: Markdown export

Export selected memory into Markdown snapshots.

Examples:

```text
docs/generated/PROJECTS.md
docs/generated/TASKS.md
docs/generated/DECISIONS.md
docs/generated/COMMON_RULES.md
```

Purpose:

Keep human-readable snapshots of the database.

---

### NF-002: Import from Markdown

Import structured Markdown into the memory database.

Useful for bootstrapping existing projects.

Also useful for collaboration: teams can review exported memory snapshots in Git and import them locally without requiring remote sync.

---

### NF-002A: Shared gateway mode

Support multiple developers and agents sharing one project memory through a common gateway.

Expected behavior:

* shared PostgreSQL database
* gateway process exposing MCP Streamable HTTP tool calls
* MCP HTTP clients can point at the gateway
* all developers can read/write project memory
* common knowledge is shared deliberately
* append-only events preserve audit history

Purpose:

Multiple developers may work on the same project. Knowledge should be immediately available to the team instead of remaining in isolated local databases.

---

### NF-003: Better ID generation

Add stable readable ID generation per project and type.

Examples:

```text
T-MEMORY-001
D-MEMORY-001
I-MEMORY-001
C-AGENT-001
```

---

### NF-004: Record templates

Add templates for common record types.

Examples:

* decision template
* task template
* failed attempt template
* feature template
* bug template

---

### NF-005: Project context bundle

Generate a compact context bundle for an agent.

Example output:

```text
project summary
active decisions
current milestone
next tasks
important common rules
recent failed attempts
```

This is broader than task preflight.

---

### NF-006: File references

Allow records to reference files.

Examples:

* a task allowed file list
* an entity implemented by a source file
* a decision linked to a documentation file

---

### NF-007: Git integration

Optional Git metadata capture.

Examples:

* commit hash when event recorded
* branch name
* dirty working tree warning

Do not include this in MVP unless easy.

---

### NF-008: Embeddings

Optional semantic search layer.

This must not replace FTS5.

Embeddings should be additive and optional.

---

## Deferred features

These should not be implemented in the MVP.

### D-001: Web UI

No web UI in MVP.

The MCP tools and optional CLI are enough.

---

### D-002: Multi-user collaboration

No accounts, roles, or permissions in MVP.

The MVP should still remain collaboration-ready through stable IDs, append-only events, human-readable docs, and future export/import paths.

---

### D-003: Remote sync

No server sync in MVP.

Prefer file-based export/import and Git-reviewed snapshots before introducing a network sync service.

The first version is local-first.

---

### D-004: Cloud database

No hosted database in MVP.

---

### D-005: Complex graph visualization

Links are useful.

Graph visualization is not required.

---

### D-006: Full issue tracker replacement

This tool can manage tasks, but it should not try to become Jira, Linear, or GitLab Issues.

---

### D-007: Generic personal knowledge management app

This is project memory for agents.

It is not a personal wiki.

---

## Suggested MCP tools

### project.create

Create a project.

Input:

* slug
* title
* description
* root path

Output:

* project record

---

### project.list

List projects.

Output:

* projects

---

### project.get

Get a project by id or slug.

---

### project.set_current

Set current project.

The current project may be stored in local config.

---

### project.current

Return current project.

---

### memory.search

Search memory records.

Input:

* query
* project
* include_common
* type
* status
* limit

Output:

* matching records

---

### memory.get

Get a memory record by id.

---

### task.create

Create task.

---

### task.list

List tasks for project.

---

### task.get

Get task by id.

---

### task.next

Return next actionable task for project.

Default ordering:

1. status `todo`
2. lowest priority value
3. oldest created timestamp

---

### task.update_status

Update task status.

Should record an event.

---

### decision.record

Record decision.

Should record an event.

---

### decision.list

List decisions for project and optionally common.

---

### event.record

Record event.

---

### preflight

Return task execution context.

Input:

* task id
* include common flag

Output:

* task
* project
* relevant decisions
* relevant common rules
* related items
* failed attempts
* recent events
* allowed files
* forbidden files
* acceptance criteria

---

## MVP Definition of Done

The MVP is done when:

1. A project can be created.
2. Common records can be seeded.
3. Tasks can be created and listed.
4. Decisions can be recorded.
5. Events can be recorded.
6. Search can find project and common records.
7. Preflight can return useful task context.
8. The MCP server exposes the core tools.
9. Data persists in SQLite.
10. The repository has clear setup and usage instructions.
