# MCP_TOOLS.md

# Project Memory MCP — Tool Specification

This document describes the initial MCP tools exposed by the Project Memory MCP server.

Tool names may be adapted to the MCP SDK naming conventions, but the concepts and behavior should remain stable.

Local SQLite stdio mode exposes the core project-memory tools.

PostgreSQL gateway mode exposes the same core tools plus gateway diagnostics and artifact storage over MCP Streamable HTTP:

* `gateway.about`
* `gateway.version`
* `gateway.diagnostics`
* `gateway.backup_manifest`
* `gateway.manuals`
* `gateway.status`
* `gateway.clients`
* `memory.upsert`
* `failed_attempt.record`
* `decision.supersede`
* `project.resolve`
* `artifact.put`
* `artifact.search`
* `artifact.list`
* `artifact.get`
* `artifact.update_metadata`
* `artifact.archive`

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

## Gateway tools

Gateway tools are available only through PostgreSQL gateway mode.

### `gateway.about`

Explain what Project Memory (`pmem`) is and how an agent should use it after connecting.

Input:

```json
{}
```

Output:

```json
{
  "about": {
    "name": "Project Memory",
    "shortName": "pmem",
    "summary": "Project Memory is a shared MCP memory gateway...",
    "manuals": {
      "tool": "gateway.manuals",
      "recommendedCalls": [
        {
          "audience": "developer",
          "includeContent": true,
          "reason": "Return the user/developer manual as Markdown."
        },
        {
          "audience": "agent",
          "includeContent": true,
          "reason": "Return the agent operating guide as Markdown."
        }
      ]
    },
    "firstCalls": [
      {
        "tool": "gateway.manuals",
        "reason": "Load Markdown manuals for developers/users and agents."
      },
      {
        "tool": "gateway.status",
        "reason": "Confirm that the agent is connected to the shared PostgreSQL gateway."
      }
    ],
    "recommendedAgentFlow": [
      "Call gateway.about if the agent has not used pmem before.",
      "Call gateway.status to confirm shared gateway mode.",
      "Call memory.search with the task topic and include common knowledge."
    ]
  }
}
```

Use this when a developer or agent asks what `project-memory` / `pmem` is, how to start, or which tools to call first.

---

### `gateway.version`

Return package and runtime identity for the connected gateway.

Input:

```json
{}
```

Output:

```json
{
  "version": {
    "name": "Project Memory",
    "shortName": "pmem",
    "packageName": "@deadragdoll/pm3m",
    "packageVersion": "1.0.0",
    "mode": "gateway",
    "storage": "postgresql",
    "tools": 39,
    "node": {
      "version": "v24.16.0"
    },
    "runtime": {
      "processName": "pm3m-gateway"
    }
  }
}
```

Use this when an agent or operator needs to confirm which pmem build is
connected.

---

### `gateway.diagnostics`

Return safe operational diagnostics without secrets.

Input:

```json
{}
```

Output:

```json
{
  "diagnostics": {
    "version": {},
    "readiness": {
      "ok": true,
      "database": "postgresql",
      "missingTables": []
    },
    "status": {
      "mode": "gateway",
      "storage": "postgresql",
      "tools": 39
    },
    "migrations": {
      "completed": ["001_init.cjs", "002_artifacts.cjs"],
      "pending": []
    },
    "runtime": {
      "bind": "127.0.0.1",
      "port": 7000,
      "apiEndpoint": "/api"
    },
    "artifacts": {
      "dir": "/var/lib/pm3m/artifacts",
      "maxBytes": 10485760
    },
    "logging": {
      "level": "info",
      "dir": "/var/log/pm3m"
    },
    "security": {
      "bearerAuth": true
    }
  }
}
```

This tool must not return `MCP_TOKEN`, database passwords, bearer values, or
other credentials.

---

### `gateway.backup_manifest`

Return the safe backup surface for operators.

Input:

```json
{}
```

Output:

```json
{
  "manifest": {
    "generatedAt": "2026-06-19T22:59:00.000+03:00",
    "version": {
      "packageName": "@deadragdoll/pm3m",
      "packageVersion": "1.0.0",
      "tools": 39
    },
    "database": {
      "engine": "postgresql",
      "host": "127.0.0.1",
      "port": 5432,
      "database": "project_memory",
      "user": "project_memory",
      "ssl": false,
      "backupRequired": true,
      "tables": ["projects", "items", "tasks", "decisions", "artifacts"],
      "tableCounts": {
        "projects": 1,
        "items": 10
      }
    },
    "artifacts": {
      "backupRequired": true,
      "dir": "/var/lib/pm3m/artifacts",
      "exists": true,
      "count": 12,
      "totalBytes": 49152,
      "maxBytes": 10485760
    },
    "migrations": {
      "completed": ["001_init.cjs", "002_artifacts.cjs"],
      "pending": []
    },
    "excludes": ["MCP_TOKEN", "POSTGRES_PASSWORD", "Authorization headers"],
    "notes": [
      "Back up PostgreSQL and ARTIFACT_DIR together to keep artifact metadata and bytes consistent."
    ]
  }
}
```

This tool does not perform a backup. It exists so an operator or agent can see
which state must be included in an external backup plan without exposing
credentials.

---

### `gateway.manuals`

Return bundled Project Memory Markdown manuals.

Use this after `gateway.about` when a developer or agent wants the actual
`.md` documentation files on their side.

Input:

```json
{
  "audience": "developer",
  "includeContent": true
}
```

`audience` may be:

* `developer`
* `user`
* `agent`
* `all`

`user` is an alias for the developer manual.

Output:

```json
{
  "manuals": [
    {
      "id": "developer",
      "audience": "developer",
      "aliases": ["user"],
      "title": "Project Memory MCP Developer Manual",
      "description": "Purpose, setup, safe usage...",
      "path": "docs/DEVELOPER_MANUAL.md",
      "contentType": "text/markdown; charset=utf-8",
      "retrieval": {
        "preferredTool": "gateway.manuals",
        "preferredInput": {
          "audience": "developer",
          "includeContent": true
        },
        "packagePath": "docs/DEVELOPER_MANUAL.md"
      },
      "content": "# Project Memory MCP — Developer Manual\n..."
    }
  ]
}
```

Call with `"includeContent": false` or omit it when only metadata is needed.

---

### `gateway.status`

Return gateway health and record counts.

Input:

```json
{}
```

Output:

```json
{
  "status": {
    "mode": "gateway",
    "storage": "postgresql",
    "tools": 39,
    "records": {
      "projects": 1,
      "items": 10,
      "tasks": 2,
      "decisions": 3,
      "events": 20
    },
    "clients": 2
  }
}
```

Use this before shared collaboration workflows to confirm the agent is connected to the shared gateway and not the local SQLite server.

---

### `gateway.clients`

List recently seen gateway clients.

Input:

```json
{
  "limit": 20
}
```

Output:

```json
{
  "clients": [
    {
      "id": "developer-or-agent-id",
      "label": "Readable Developer Or Agent Name",
      "lastSeenAt": "2026-06-18T20:00:00.000Z",
      "metadata": {
        "kind": "mcp-http"
      }
    }
  ]
}
```

Use this to inspect which developers or agents have touched the shared memory gateway recently.

Each MCP HTTP client should send stable identity headers when available:

```text
X-Project-Memory-Client-ID: developer-or-agent-id
X-Project-Memory-Client-Label: Readable Developer Or Agent Name
X-Project-Memory-Client-Kind: mcp-http
```

Clients that cannot send custom headers, such as Codex CLI streamable HTTP MCP config, can use query parameters on the MCP URL:

```text
https://pmem.undoo.ru/api/mcp?client_id=developer@host&client_label=Developer%20Host&client_kind=codex
```

---

### `artifact.put`

Store or update a shared artifact file on the gateway.

Input:

```json
{
  "project": "project-memory-mcp",
  "path": "templates/frontend/AGENTS.md",
  "title": "Frontend AGENTS.md",
  "description": "Reusable frontend agent instructions.",
  "contentType": "text/markdown; charset=utf-8",
  "contentBase64": "IyBBR0VOVFMubWQK",
  "tags": ["agents", "frontend", "template"],
  "overwrite": true
}
```

For common artifacts, pass `"common": true` instead of `project`.

Output:

```json
{
  "artifact": {
    "id": "A-MEMORY-001",
    "scope": "project",
    "path": "templates/frontend/AGENTS.md",
    "title": "Frontend AGENTS.md",
    "contentType": "text/markdown; charset=utf-8",
    "sizeBytes": 1234,
    "sha256": "...",
    "downloadPath": "/artifacts/A-MEMORY-001/download",
    "tags": ["agents", "frontend", "template"]
  }
}
```

Agents upload content as base64 so this works for Markdown and binary files. The gateway stores bytes on disk under `ARTIFACT_DIR` and metadata in PostgreSQL.

---

### `artifact.search`

Search shared artifact metadata.

Input:

```json
{
  "query": "frontend AGENTS template",
  "includeCommon": true,
  "includeArchived": false,
  "tags": ["agents"],
  "limit": 10
}
```

Output:

```json
{
  "results": [
    {
      "id": "A-COMMON-001",
      "scope": "common",
      "path": "templates/frontend/AGENTS.md",
      "title": "Frontend AGENTS.md",
      "downloadPath": "/artifacts/A-COMMON-001/download"
    }
  ]
}
```

To download an artifact, append `downloadPath` to `GW_ENDPOINT`, for example:

```text
https://pmem.undoo.ru/api/artifacts/A-COMMON-001/download
```

Bearer auth is still required.

Archived artifacts are hidden by default. Pass `includeArchived=true` or
`status="archived"` when searching archived records intentionally.

---

### `artifact.list`

List artifacts for navigation by scope, path prefix, tags, and lifecycle status.

Input:

```json
{
  "project": "project-memory-mcp",
  "includeCommon": true,
  "pathPrefix": "templates/frontend",
  "tags": ["agents"],
  "status": "active",
  "limit": 50
}
```

For common-only artifact navigation:

```json
{
  "common": true,
  "pathPrefix": "templates",
  "includeArchived": true
}
```

Output:

```json
{
  "artifacts": [
    {
      "id": "A-COMMON-001",
      "scope": "common",
      "path": "templates/frontend/AGENTS.md",
      "title": "Frontend AGENTS.md",
      "status": "active",
      "downloadPath": "/artifacts/A-COMMON-001/download"
    }
  ]
}
```

Behavior:

* defaults to current project plus common artifacts
* supports common-only listing with `common=true` or `project=null`
* filters by safe relative `pathPrefix`
* filters by JSON tags
* hides archived artifacts unless `includeArchived=true` or `status="archived"`
* sorts by project artifacts first, then common, then path

Use this when an agent needs to browse a folder-like artifact hierarchy. Use
`artifact.search` when the agent needs fuzzy full-text lookup.

---

### `artifact.get`

Get artifact metadata by id or project/path.

Input by id:

```json
{
  "id": "A-COMMON-001"
}
```

Input by path:

```json
{
  "project": "project-memory-mcp",
  "path": "templates/frontend/AGENTS.md"
}
```

For small files, agents may request inline base64 content:

```json
{
  "id": "A-COMMON-001",
  "includeContent": true,
  "maxBytes": 1048576
}
```

Use direct download for larger files and binaries.

---

### `artifact.update_metadata`

Update artifact metadata without re-uploading bytes.

Input by id:

```json
{
  "id": "A-COMMON-001",
  "title": "Frontend AGENTS.md template",
  "description": "Reusable frontend instructions for agents.",
  "tags": ["agents", "frontend", "template"]
}
```

Input by path:

```json
{
  "project": "project-memory-mcp",
  "path": "templates/frontend/AGENTS.md",
  "tags": ["agents", "frontend", "updated"]
}
```

Output:

```json
{
  "artifact": {
    "id": "A-COMMON-001",
    "title": "Frontend AGENTS.md template",
    "description": "Reusable frontend instructions for agents.",
    "sha256": "...",
    "downloadPath": "/artifacts/A-COMMON-001/download"
  }
}
```

Behavior:

* updates `title`, `description`, and/or `tags`
* does not change file bytes, `contentType`, `sizeBytes`, or `sha256`
* records an `artifact.metadata_updated` event

Use this when an uploaded artifact is good but its search metadata needs to be
cleaned up.

---

### `artifact.archive`

Archive an artifact without deleting bytes.

Input by id:

```json
{
  "id": "A-COMMON-001",
  "reason": "Superseded by a newer frontend template."
}
```

Input by path:

```json
{
  "project": "project-memory-mcp",
  "path": "templates/frontend/AGENTS.md"
}
```

Output:

```json
{
  "action": "archived",
  "artifact": {
    "id": "A-COMMON-001",
    "status": "archived",
    "archivedAt": "2026-06-19T23:10:00.000+03:00",
    "archiveReason": "Superseded by a newer frontend template."
  },
  "event": {
    "type": "artifact.archived",
    "relatedId": "A-COMMON-001"
  }
}
```

Behavior:

* marks the artifact as `archived`
* keeps file bytes and metadata available by id/path
* hides the artifact from default `artifact.search`
* records an `artifact.archived` event

Use this instead of deleting shared files. Agents can still retrieve archived
artifacts when they have an explicit id/path or search with `includeArchived`.

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

### `project.resolve`

Resolve a likely project from repository context.

Input examples:

```json
{
  "rootPath": "/home/user/dev/project-memory-mcp/src"
}
```

```json
{
  "remoteUrl": "git@github.com:deadragdoll/project-memory-mcp.git",
  "query": "project memory"
}
```

Output:

```json
{
  "resolved": {
    "id": "P-MEMORY",
    "slug": "project-memory-mcp",
    "title": "Project Memory MCP"
  },
  "ambiguous": false,
  "candidates": [
    {
      "project": {
        "id": "P-MEMORY",
        "slug": "project-memory-mcp",
        "rootPath": "/home/user/dev/project-memory-mcp"
      },
      "score": 80,
      "reasons": ["rootPathParent"]
    }
  ]
}
```

Fields:

* `id`, `slug`, `title`, `rootPath`, `remoteUrl`, or `query`; at least one is
  required
* `limit` defaults to 10

Behavior:

* scores active projects by exact id, slug, title, root path, parent root path,
  remote repository name, and query match
* returns `resolved` only when there is a single best candidate
* returns `resolved: null` with candidates when the result is ambiguous
* does not change current project

Use this when an agent connects from a repository and needs to discover the
right shared project scope before recording memory or running preflight.

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

### `memory.upsert`

Create or update a memory item idempotently.

When `id` is provided, the gateway first tries to match by `id`. Otherwise it
matches by scope, `type`, and `title`:

```text
project/common + type + title
```

Input:

```json
{
  "project": "project-memory-mcp",
  "type": "workflow_rule",
  "title": "Run diagnostics before deploy",
  "body": "Before deploying pm3m, run gateway diagnostics and migration status.",
  "tags": ["gateway", "deploy"],
  "match": "scope_type_title"
}
```

Output:

```json
{
  "action": "updated",
  "item": {
    "id": "I-MEMORY-001",
    "projectId": "P-MEMORY",
    "type": "workflow_rule",
    "title": "Run diagnostics before deploy"
  }
}
```

Use this when an agent records durable knowledge that may already exist. It
reduces duplicate common/project records.

---

### `failed_attempt.record`

Record a failed attempt as first-class searchable memory.

Input:

```json
{
  "project": "project-memory-mcp",
  "title": "PM2 ecosystem object passed incorrectly",
  "whatTried": "Started PM2 with a generated ecosystem module that did not export the expected object.",
  "whyFailed": "PM2 tried to read config.deploy from an undefined config object.",
  "doNotRepeat": "Do not call PM2 startOrReload with an ecosystem file that cannot be resolved by PM2's loader.",
  "betterNextApproach": "Generate a plain .cjs ecosystem file and fall back to direct pm2 start when reload fails.",
  "relatedId": "T-MEMORY-003",
  "tags": ["pm2", "deploy"]
}
```

Output:

```json
{
  "action": "created",
  "attempt": {
    "id": "I-MEMORY-002",
    "projectId": "P-MEMORY",
    "type": "failed_attempt",
    "title": "PM2 ecosystem object passed incorrectly"
  },
  "event": {
    "type": "attempt.failed",
    "relatedId": "I-MEMORY-002"
  },
  "link": {
    "relation": "warns_against",
    "fromId": "I-MEMORY-002",
    "toId": "T-MEMORY-003"
  }
}
```

Behavior:

* stores the attempt as `type="failed_attempt"`
* formats the body from `whatTried`, `whyFailed`, `doNotRepeat`, and optional
  `betterNextApproach`
* upserts by project/common scope, type, and title by default
* records an `attempt.failed` event
* when `relatedId` is provided, creates a `warns_against` link
* preflight includes matching failed attempts in `failedAttempts`

Use this immediately after a meaningful failed implementation, deploy, or
debugging attempt. Agents should search/read these records before retrying a
similar task.

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

### `decision.supersede`

Create a replacement decision and supersede the old one in one explicit
workflow.

Input:

```json
{
  "supersedesId": "D-MEMORY-001",
  "title": "Use PostgreSQL for shared gateway storage",
  "context": "The project now supports multi-developer collaboration through a shared gateway.",
  "decision": "Use PostgreSQL for gateway mode.",
  "rationale": "Multiple agents need a shared durable database instead of local-only SQLite.",
  "consequences": "Local stdio mode remains separate; shared deployments must back up PostgreSQL and artifacts together.",
  "tags": ["gateway", "storage"]
}
```

Output:

```json
{
  "decision": {
    "id": "D-MEMORY-002",
    "status": "active",
    "supersedesId": "D-MEMORY-001"
  },
  "superseded": {
    "id": "D-MEMORY-001",
    "status": "superseded"
  },
  "link": {
    "relation": "supersedes",
    "fromId": "D-MEMORY-002",
    "toId": "D-MEMORY-001"
  },
  "event": {
    "type": "decision.superseded",
    "relatedId": "D-MEMORY-002"
  }
}
```

Behavior:

* creates the replacement decision in the same project/common scope as the old
  decision unless the caller explicitly passes the same scope
* marks the old decision as `superseded`
* records a `supersedes` link from the new decision to the old one
* records `decision.superseded` and `link.created` events

Use this when project guidance changes. Agents should prefer this over manually
recording a new decision and separately updating the old status.

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
* gateway mode reports status and recently seen clients
