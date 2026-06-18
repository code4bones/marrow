# MCP_TOOLS.md

# Project Memory MCP — Tool Specification

This document describes the initial MCP tools exposed by the Project Memory MCP server.

Tool names may be adapted to the MCP SDK naming conventions, but the concepts and behavior should remain stable.

## General response format

All tools should return structured responses.

Success:

```json
{
  "ok": true,
  "summary": "Short human-readable summary.",
  "data": {}
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message.",
    "details": {}
  }
}
```

Avoid raw stack traces in tool responses.

## Project tools

### `project.create`

Create a new project.

Input:

```json
{
  "slug": "project-memory-mcp",
  "title": "Project Memory MCP",
  "description": "Local-first MCP server for project memory.",
  "rootPath": "/home/user/dev/project-memory-mcp"
}
```

Required:

* `slug`
* `title`

Output:

```json
{
  "project": {
    "id": "P-MEMORY",
    "slug": "project-memory-mcp",
    "title": "Project Memory MCP",
    "status": "active"
  }
}
```

Behavior:

* slug must be unique
* status defaults to `active`
* record `project.created` event

---

### `project.list`

List projects.

Input:

```json
{
  "status": "active"
}
```

All fields optional.

Output:

```json
{
  "projects": []
}
```

---

### `project.get`

Get a project by id or slug.

Input:

```json
{
  "id": "P-MEMORY"
}
```

or:

```json
{
  "slug": "project-memory-mcp"
}
```

Output:

```json
{
  "project": {}
}
```

---

### `project.set_current`

Set the current project.

Input:

```json
{
  "slug": "project-memory-mcp"
}
```

or:

```json
{
  "id": "P-MEMORY"
}
```

Output:

```json
{
  "currentProject": {}
}
```

Behavior:

* validate project exists
* store current project in config or `kv`
* environment variable may override stored current project

---

### `project.current`

Return current project.

Input:

```json
{}
```

Output:

```json
{
  "project": {}
}
```

Failure:

```text
CURRENT_PROJECT_NOT_SET
```

if no current project is configured.

## Memory tools

### `memory.create`

Create a generic typed memory item.

Input:

```json
{
  "project": "project-memory-mcp",
  "type": "agent_rule",
  "title": "Keep diffs small",
  "body": "Agents should prefer small, reviewable diffs and avoid unrelated refactors.",
  "status": "active",
  "tags": ["common", "agent", "workflow"]
}
```

For common item:

```json
{
  "project": null,
  "type": "agent_rule",
  "title": "Always run preflight",
  "body": "Before starting a task, call preflight.",
  "tags": ["common", "agent"]
}
```

Output:

```json
{
  "item": {}
}
```

Behavior:

* if `project` is null or omitted with `common=true`, create common item
* record `item.created` event

---

### `memory.get`

Get a memory item by id.

Input:

```json
{
  "id": "C-AGENT-001"
}
```

Output:

```json
{
  "item": {}
}
```

---

### `memory.search`

Search memory items.

Input:

```json
{
  "query": "preflight small diffs",
  "project": "project-memory-mcp",
  "includeCommon": true,
  "type": "agent_rule",
  "status": "active",
  "limit": 10
}
```

Fields:

* `query` required
* `project` optional if current project is set
* `includeCommon` defaults to true
* `type` optional
* `status` optional
* `limit` defaults to 10

Output:

```json
{
  "results": [
    {
      "id": "C-AGENT-001",
      "scope": "common",
      "type": "agent_rule",
      "title": "Always run preflight",
      "excerpt": "Before starting a task, call preflight...",
      "status": "active",
      "tags": ["common", "agent"]
    }
  ]
}
```

Ranking:

1. project-specific records
2. common records
3. FTS rank within each group

---

### `memory.update`

Update a generic memory item.

Input:

```json
{
  "id": "I-MEMORY-001",
  "title": "Updated title",
  "body": "Updated body",
  "status": "active",
  "tags": ["architecture"]
}
```

All fields except `id` are optional.

Output:

```json
{
  "item": {}
}
```

Behavior:

* update `updated_at`
* keep FTS in sync through triggers
* record `item.updated` event

## Task tools

### `task.create`

Create a task.

Input:

```json
{
  "project": "project-memory-mcp",
  "title": "Implement project registry",
  "milestone": "MVP",
  "priority": 10,
  "scope": "Implement project create/list/get/current functionality.",
  "acceptance": "Project can be created, listed, retrieved, and set as current.",
  "allowedFiles": [
    "src/features/projects/**",
    "docs/MCP_TOOLS.md"
  ],
  "forbiddenFiles": [
    "src/features/preflight/**"
  ],
  "dependsOn": [],
  "notes": "Keep implementation small."
}
```

Required:

* project or current project
* title

Output:

```json
{
  "task": {}
}
```

Behavior:

* status defaults to `todo`
* record `task.created` event

---

### `task.list`

List tasks.

Input:

```json
{
  "project": "project-memory-mcp",
  "status": "todo",
  "milestone": "MVP",
  "limit": 20
}
```

Output:

```json
{
  "tasks": []
}
```

---

### `task.get`

Get task by id.

Input:

```json
{
  "id": "T-MEMORY-001"
}
```

Output:

```json
{
  "task": {}
}
```

---

### `task.next`

Return next actionable task.

Input:

```json
{
  "project": "project-memory-mcp"
}
```

Output:

```json
{
  "task": {}
}
```

Ordering:

1. status `todo`
2. lowest priority number
3. oldest created timestamp

---

### `task.update_status`

Update task status.

Input:

```json
{
  "id": "T-MEMORY-001",
  "status": "doing",
  "note": "Started implementation."
}
```

Allowed statuses:

```text
todo
doing
blocked
done
cancelled
```

Output:

```json
{
  "task": {}
}
```

Behavior:

* update `updated_at`
* record event:

  * `task.started`
  * `task.completed`
  * `task.blocked`
  * `task.cancelled`
  * or `task.status_changed`

## Decision tools

### `decision.record`

Record a decision.

Input:

```json
{
  "project": "project-memory-mcp",
  "title": "Use SQLite FTS5 for MVP search",
  "status": "active",
  "context": "The project needs local search for agent memory.",
  "decision": "Use SQLite FTS5 in the MVP instead of embeddings.",
  "rationale": "FTS5 is local, deterministic, simple, and enough for early project memory.",
  "consequences": "Semantic embeddings can be added later as an optional feature.",
  "tags": ["architecture", "search", "mvp"],
  "supersedesId": null
}
```

For common decision:

```json
{
  "project": null,
  "title": "Prefer small reviewable diffs",
  "decision": "Agents should keep changes small unless explicitly asked otherwise.",
  "tags": ["common", "agent"]
}
```

Required:

* title
* decision

Output:

```json
{
  "decision": {}
}
```

Behavior:

* record `decision.recorded` event
* if `supersedesId` is provided, optionally mark old decision as `superseded`

---

### `decision.list`

List decisions.

Input:

```json
{
  "project": "project-memory-mcp",
  "includeCommon": true,
  "status": "active",
  "limit": 20
}
```

Output:

```json
{
  "decisions": []
}
```

Default:

* include current project decisions
* include common decisions if `includeCommon` is true

---

### `decision.get`

Get decision by id.

Input:

```json
{
  "id": "D-MEMORY-001"
}
```

Output:

```json
{
  "decision": {}
}
```

## Event tools

### `event.record`

Record an event.

Input:

```json
{
  "project": "project-memory-mcp",
  "type": "attempt.failed",
  "title": "FTS trigger mismatch",
  "body": "The first FTS trigger used rowid incorrectly. Use explicit id field in FTS table.",
  "relatedId": "T-MEMORY-003"
}
```

Required:

* type

Output:

```json
{
  "event": {}
}
```

---

### `event.list`

List events.

Input:

```json
{
  "project": "project-memory-mcp",
  "relatedId": "T-MEMORY-001",
  "limit": 20
}
```

Output:

```json
{
  "events": []
}
```

## Link tools

### `link.create`

Create a link between two records.

Input:

```json
{
  "project": "project-memory-mcp",
  "fromId": "T-MEMORY-003",
  "toId": "D-MEMORY-001",
  "relation": "depends_on"
}
```

Output:

```json
{
  "link": {}
}
```

---

### `link.list`

List links for a record.

Input:

```json
{
  "id": "T-MEMORY-003",
  "direction": "both"
}
```

Allowed direction:

```text
from
to
both
```

Output:

```json
{
  "links": []
}
```

## Preflight tool

### `preflight`

Return execution context for a task.

This is the most important tool.

Input:

```json
{
  "taskId": "T-MEMORY-003",
  "includeCommon": true,
  "limits": {
    "decisions": 10,
    "items": 10,
    "failedAttempts": 5,
    "events": 10
  }
}
```

Output:

```json
{
  "project": {
    "id": "P-MEMORY",
    "slug": "project-memory-mcp",
    "title": "Project Memory MCP"
  },
  "task": {
    "id": "T-MEMORY-003",
    "title": "Implement FTS search",
    "status": "todo",
    "scope": "...",
    "acceptance": "...",
    "allowedFiles": [],
    "forbiddenFiles": []
  },
  "relevantDecisions": [],
  "commonRules": [],
  "relatedItems": [],
  "failedAttempts": [],
  "recentEvents": [],
  "summary": "Use this context before editing files."
}
```

Preflight should include:

* task
* project
* active project decisions
* active common rules
* items matching task title/scope
* failed attempts matching task title/scope
* recent events for the project
* dependencies if any
* allowed files
* forbidden files
* acceptance criteria

Behavior:

* fail if task does not exist
* fail if task project does not exist
* include common records by default
* project decisions should appear before common rules
* do not return excessive data

## Seed tools or scripts

MVP can use scripts instead of MCP tools for seeding.

Recommended scripts:

```bash
npm run seed:common
npm run seed:demo
```

Common seed records:

```text
C-AGENT-001 Always run preflight before task execution
C-AGENT-002 Keep diffs small and reviewable
C-AGENT-003 Do not expand scope without explicit request
C-AGENT-004 Record failed attempts
C-TASK-001 Every task needs acceptance criteria
C-TASK-002 Allowed and forbidden files should be explicit
C-ARCH-001 Prefer feature-oriented architecture
C-ARCH-002 Shared code must be genuinely reusable
```

## Tool Definition of Done

The MCP tool layer is acceptable when:

* all MVP tools validate inputs
* tools do not contain direct SQL
* tools call feature services
* errors are structured
* current project behavior is explicit
* project + common search works
* preflight returns useful context
* task status changes record events
* decision recording records events
* common seeding works
