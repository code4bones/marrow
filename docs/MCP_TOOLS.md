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
* `gateway.client_get`
* `gateway.client_forget`
* `gateway.client_prune`
* `memory.upsert`
* `failed_attempt.record`
* `decision.supersede`
* `project.resolve`
* `project.summary`
* `memory.hygiene_report`
* `preflight.by_query`
* `context.pack`
* `context.changed_since`
* `handoff.create`
* `handoff.latest`
* `handoff.search`
* `artifact.put`
* `artifact.put_text`
* `artifact.search`
* `artifact.list`
* `artifact.peek`
* `artifact.read_text`
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
          "audience": "onboarding",
          "includeContent": true,
          "reason": "Return the first-run agent onboarding guide as Markdown."
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
        "reason": "Load Markdown manuals for developers/users, onboarding, and agents."
      },
      {
        "tool": "gateway.status",
        "reason": "Confirm that the agent is connected to the shared PostgreSQL gateway."
      },
      {
        "tool": "project.resolve",
        "reason": "Resolve project scope before writing memory."
      },
      {
        "tool": "preflight.by_query",
        "reason": "Load ad-hoc context before a task exists."
      }
    ],
    "onboardingFlow": [
      "gateway.about",
      "gateway.status",
      "gateway.version",
      "gateway.manuals(audience=\"onboarding\", includeContent=true)",
      "project.resolve",
      "project.current or project.set_current",
      "preflight.by_query for ad-hoc work, or task.next -> task.get -> preflight for recorded tasks",
      "artifact.search or artifact.list before creating local AGENTS.md/templates"
    ],
    "recommendedAgentFlow": [
      "Call gateway.about if the agent has not used pmem before.",
      "Call gateway.status to confirm shared gateway mode.",
      "Call memory.search with the task topic and include common knowledge."
    ],
    "connectionSnippets": [
      {
        "client": "codex",
        "transport": "streamable-http",
        "url": "https://<gateway-host>/api/mcp?client_id=${PMEM_CLIENT_ID}&client_label=${PMEM_CLIENT_LABEL}&client_kind=<client-kind>"
      },
      {
        "client": "codewhale",
        "configPath": ".deepseek/mcp.json"
      }
    ]
  }
}
```

Use this when a developer or agent asks what `project-memory` / `pmem` is, how
to start, which tools to call first, or how to connect another MCP client.

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
    "packageVersion": "1.14.0",
    "mode": "gateway",
    "storage": "postgresql",
    "tools": 53,
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
      "tools": 53
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
    "clients": {
      "anonymousTtlSeconds": 86400
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
      "packageVersion": "1.14.0",
      "tools": 53
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
* `manual`
* `onboarding`
* `start`
* `first-run`
* `quickstart`
* `agent`
* `workflow`
* `conventions`
* `collaboration`
* `all`

`user` and `manual` are aliases for the developer manual. `start`,
`first-run`, and `quickstart` are aliases for the onboarding guide. `workflow`
is an alias for the agent guide. `collaboration` is an alias for the
collaboration conventions manual.

Output:

```json
{
  "manuals": [
    {
      "id": "developer",
      "audience": "developer",
      "aliases": ["user", "manual"],
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
    },
    {
      "id": "conventions",
      "audience": "conventions",
      "aliases": ["collaboration"],
      "title": "Project Memory MCP Collaboration Conventions",
      "description": "Shared storage-surface mapping and collaboration rules...",
      "path": "docs/PROJECT_MEMORY_COLLABORATION_CONVENTIONS.md",
      "contentType": "text/markdown; charset=utf-8",
      "retrieval": {
        "preferredTool": "gateway.manuals",
        "preferredInput": {
          "audience": "conventions",
          "includeContent": true
        },
        "packagePath": "docs/PROJECT_MEMORY_COLLABORATION_CONVENTIONS.md"
      },
      "content": "# Project Memory MCP - Collaboration Conventions\n..."
    },
    {
      "id": "onboarding",
      "audience": "onboarding",
      "aliases": ["start", "first-run", "quickstart"],
      "title": "Project Memory MCP Agent Onboarding",
      "path": "docs/AGENT_ONBOARDING.md",
      "content": "# Project Memory MCP — Agent Onboarding\n..."
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
    "tools": 53,
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
  "anonymous": false,
  "staleOlderThanSeconds": 86400,
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

Use this to inspect which developers or agents have touched the shared memory
gateway recently. `anonymous` filters temporary anonymous clients; omit it to
list all clients. `staleOlderThanSeconds` filters clients whose `lastSeenAt` is
older than the requested age.

---

### `gateway.client_get`

Get one gateway client and its current project key.

Input:

```json
{
  "id": "developer-or-agent-id"
}
```

Output:

```json
{
  "client": {
    "id": "developer-or-agent-id",
    "label": "Readable Developer Or Agent Name",
    "lastSeenAt": "2026-06-18T20:00:00.000Z",
    "metadata": {
      "kind": "mcp-http"
    },
    "currentProjectId": "P-MEMORY"
  }
}
```

---

### `gateway.client_forget`

Remove one gateway client and its `current_project_id:<client_id>` key.

Input:

```json
{
  "id": "old-client-id"
}
```

Output:

```json
{
  "client": {},
  "forgotten": true,
  "removedCurrentProjectKey": true
}
```

Use this for stale or renamed internal clients. It does not remove records that
the client created.

---

### `gateway.client_prune`

Dry-run or prune stale gateway clients and matching current-project keys.

Input:

```json
{
  "anonymousOnly": true,
  "olderThanSeconds": 86400,
  "dryRun": true,
  "limit": 100
}
```

Output:

```json
{
  "dryRun": true,
  "anonymousOnly": true,
  "olderThanSeconds": 86400,
  "matched": 2,
  "pruned": 0,
  "clients": []
}
```

Defaults are conservative: `anonymousOnly=true`, `dryRun=true`, and
`olderThanSeconds=GATEWAY_ANONYMOUS_CLIENT_TTL_SECONDS`. Set `dryRun=false` to
delete matched clients.

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

### `artifact.put_text`

Store or update a shared UTF-8 text or Markdown artifact on the gateway
without base64.

Prefer this for templates, generated Markdown, handoffs, docs, checklists,
JSON/YAML snippets, and other text-first collaboration files.

Input:

```json
{
  "common": true,
  "path": "templates/agents/frontend/AGENTS.md",
  "title": "Frontend AGENTS.md",
  "description": "Reusable frontend agent instructions.",
  "contentType": "text/markdown; charset=utf-8",
  "text": "# AGENTS.md\n\nFrontend instructions...",
  "tags": ["agents", "frontend", "template"],
  "overwrite": true
}
```

For project artifacts, pass `project` instead of `"common": true`:

```json
{
  "project": "project-memory-mcp",
  "path": "docs/snapshots/architecture-2026-06-20.md",
  "text": "# Architecture Snapshot\n\n..."
}
```

Output:

```json
{
  "artifact": {
    "id": "A-COMMON-001",
    "scope": "common",
    "path": "templates/agents/frontend/AGENTS.md",
    "title": "Frontend AGENTS.md",
    "contentType": "text/markdown; charset=utf-8",
    "sizeBytes": 1234,
    "sha256": "...",
    "downloadPath": "/artifacts/A-COMMON-001/download",
    "tags": ["agents", "frontend", "template"]
  }
}
```

`artifact.put_text` stores UTF-8 bytes in the same artifact storage as
`artifact.put`, records the same `artifact.created` / `artifact.updated` events,
and returns the same conflict response when the scope/path already exists and
`overwrite` is not `true`. It rejects explicitly non-text content types; use
`artifact.put` for binary files.

---

### `artifact.put`

Store or update a shared artifact file on the gateway from base64 bytes.

Use this for binary files, exact byte transport, or clients that cannot send
text safely. For Markdown and ordinary text, prefer `artifact.put_text`.

Input:

```json
{
  "project": "project-memory-mcp",
  "path": "templates/agents/frontend/AGENTS.md",
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
    "path": "templates/agents/frontend/AGENTS.md",
    "title": "Frontend AGENTS.md",
    "contentType": "text/markdown; charset=utf-8",
    "sizeBytes": 1234,
    "sha256": "...",
    "downloadPath": "/artifacts/A-MEMORY-001/download",
    "tags": ["agents", "frontend", "template"]
  }
}
```

Agents upload content as base64 so this works for binary files and exact byte
transport. The gateway stores bytes on disk under `ARTIFACT_DIR` and metadata
in PostgreSQL.

If the same scope/path already exists and `overwrite` is not `true`, the tool
returns `ok=false` with `error.code="ARTIFACT_CONFLICT"`:

```json
{
  "ok": false,
  "error": {
    "code": "ARTIFACT_CONFLICT",
    "message": "Artifact already exists. Choose overwrite, a versioned path, or archive the existing artifact first.",
    "details": {
      "existing": {
        "id": "A-COMMON-001",
        "path": "templates/agents/frontend/AGENTS.md",
        "downloadPath": "/artifacts/A-COMMON-001/download"
      },
      "suggestedActions": [
        { "action": "keep_existing" },
        { "action": "overwrite" },
        { "action": "versioned_path" },
        { "action": "archive_then_put" }
      ]
    }
  }
}
```

Agents should ask before `overwrite` or `archive_then_put` unless the user
already explicitly requested replacement.

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
      "path": "templates/agents/frontend/AGENTS.md",
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
  "pathPrefix": "templates/agents/frontend",
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
      "path": "templates/agents/frontend/AGENTS.md",
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

### `artifact.peek`

Get a compact artifact preview without base64 content.

Use this when an agent needs to decide whether the full file is relevant. For
Markdown/text content, follow it with `artifact.read_text`; use
`artifact.get(includeContent=true)` only when exact bytes are needed.

Input:

```json
{
  "id": "A-COMMON-001",
  "maxBytes": 65536,
  "excerptChars": 4000,
  "outlineLimit": 40
}
```

Input by path:

```json
{
  "project": "project-memory-mcp",
  "path": "docs/design.md"
}
```

Output for Markdown/text artifacts:

```json
{
  "artifact": {
    "id": "A-COMMON-001",
    "path": "conventions/PROJECT_MEMORY_COLLABORATION.md",
    "contentType": "text/markdown; charset=utf-8",
    "sizeBytes": 9005,
    "downloadPath": "/artifacts/A-COMMON-001/download",
    "preview": {
      "isText": true,
      "isMarkdown": true,
      "truncated": false,
      "readBytes": 9005,
      "maxBytes": 65536,
      "excerpt": "# Project Memory...",
      "outline": [
        { "level": 1, "title": "Project Memory MCP - Collaboration Conventions", "line": 1 },
        { "level": 2, "title": "Core Principle", "line": 14 }
      ]
    }
  }
}
```

Output for binary or non-text artifacts keeps metadata only:

```json
{
  "artifact": {
    "id": "A-COMMON-020",
    "contentType": "application/octet-stream",
    "downloadPath": "/artifacts/A-COMMON-020/download",
    "preview": {
      "isText": false,
      "isMarkdown": false,
      "truncated": false,
      "excerpt": null,
      "outline": [],
      "note": "Binary or non-text artifact. Use downloadPath when bytes are needed."
    }
  }
}
```

`artifact.peek` never returns `contentBase64`.

---

### `artifact.read_text`

Read bounded UTF-8 text from a text or Markdown artifact without base64
content. This is the preferred tool when ChatGPT or another agent needs the
actual content of an artifact in model context.

Input:

```json
{
  "id": "A-COMMON-001",
  "maxBytes": 131072,
  "maxChars": 20000,
  "maxLines": 500,
  "outlineLimit": 40
}
```

Input by path:

```json
{
  "project": "project-memory-mcp",
  "path": "templates/agents/frontend/AGENTS.md"
}
```

Output:

```json
{
  "artifact": {
    "id": "A-COMMON-001",
    "path": "templates/agents/frontend/AGENTS.md",
    "contentType": "text/markdown; charset=utf-8",
    "downloadPath": "/artifacts/A-COMMON-001/download",
    "text": "# AGENTS.md\n\n...",
    "textInfo": {
      "isText": true,
      "isMarkdown": true,
      "encoding": "utf8",
      "readBytes": 12042,
      "maxBytes": 131072,
      "maxChars": 20000,
      "maxLines": 500,
      "truncated": false,
      "truncatedByBytes": false,
      "truncatedByChars": false,
      "truncatedByLines": false,
      "redacted": false,
      "redactions": 0,
      "base64Included": false
    },
    "outline": [
      { "level": 1, "title": "AGENTS.md", "line": 1 }
    ]
  }
}
```

`artifact.read_text` rejects binary artifacts, never returns `contentBase64`,
and redacts obvious token/password/private-key patterns by default. Pass
`redactSecrets=false` only for trusted internal debugging when the user
explicitly needs exact bytes; prefer `artifact.get(includeContent=true)` for
exact base64 transport.

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
  "path": "templates/agents/frontend/AGENTS.md"
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

Agents should usually call `artifact.peek` first for orientation, then
`artifact.read_text` for Markdown/text content. Use inline base64 only when
the exact file bytes are needed in the model context.

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
  "path": "templates/agents/frontend/AGENTS.md",
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
  "path": "templates/agents/frontend/AGENTS.md"
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

### `project.summary`

Return a compact project state card for the selected or current project.

Input:

```json
{
  "project": "project-memory-mcp",
  "query": "OAuth facade ChatGPT Apps",
  "includeCommon": true,
  "limits": {
    "tasks": 8,
    "decisions": 5,
    "faults": 5,
    "handoffs": 3,
    "artifacts": 5,
    "memory": 6,
    "events": 5
  }
}
```

Omit `project` to use the requesting client's current project. Omit `query` to
derive a broad project query from the project title, slug, and description.

Output:

```json
{
  "project": {
    "id": "P-MEMORY",
    "slug": "project-memory-mcp",
    "title": "Project Memory MCP"
  },
  "counts": {
    "tasks": 18,
    "openTasks": 2,
    "items": 42,
    "decisions": 6,
    "artifacts": 14,
    "events": 109
  },
  "openTasks": [],
  "handoffs": [],
  "decisions": [],
  "knownFaults": [],
  "artifacts": [],
  "memory": [],
  "recentEvents": [],
  "nextCalls": [
    {
      "tool": "context.pack",
      "input": {
        "project": "P-MEMORY",
        "query": "OAuth facade ChatGPT Apps",
        "mode": "normal"
      }
    }
  ]
}
```

`project.summary` is intentionally compact. It does not include full memory
bodies or artifact base64 content. Follow `nextCalls` when a compact card is not
enough.

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
* in gateway mode, store current project per client id
* requests without a client id use a temporary `anonymous:<request-id>` scope
* legacy global `kv.current_project_id` may be used only as a fallback
* local mode may store current project in local config or `kv`

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

In shared gateway mode, current project is scoped to the requesting client. One
developer or agent changing current project must not change another client's
implicit project scope.

Gateway clients should send a stable `client_id`. If omitted, pmem assigns a
temporary anonymous id for the request, so current project state is isolated but
not durable. Temporary anonymous client records and their current-project keys
are cleaned up after `GATEWAY_ANONYMOUS_CLIENT_TTL_SECONDS`; set it to `0` to
disable cleanup.

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

Record a failed attempt as first-class searchable fault memory.

Faults are mistakes or broken approaches that future agents should notice
before retrying similar work. `failed_attempt.record` is the canonical fault
recording tool in the current API.

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
* preflight includes matching records in both `failedAttempts` and
  `knownFaults`

Use this immediately after a meaningful failed implementation, deploy, or
debugging attempt. Agents should search/read these records before retrying a
similar task. Treat `doNotRepeat` as a hard stop unless the user explicitly
chooses a new approach.

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

---

### `memory.hygiene_report`

Return read-only memory quality signals for a project/common scope.

Input:

```json
{
  "project": "project-memory-mcp",
  "includeCommon": true,
  "largeBodyChars": 4000,
  "staleDays": 90,
  "limit": 20
}
```

Use `"project": null` for common-only hygiene. Omit `project` to use the
requesting client's current project when available.

Output:

```json
{
  "summary": "Read-only memory hygiene report...",
  "thresholds": {
    "largeBodyChars": 4000,
    "staleDays": 90
  },
  "scanned": {
    "activeItems": 120
  },
  "findings": {
    "largeRecords": [
      {
        "id": "I-MEMORY-021",
        "type": "handoff",
        "title": "Large handoff",
        "bodyChars": 9200,
        "updatedAt": "2026-06-20T14:00:00.000Z"
      }
    ],
    "staleRecords": [],
    "duplicateTitleGroups": [
      {
        "type": "workflow_rule",
        "title": "Always run preflight",
        "count": 2,
        "ids": ["C-AGENT-001", "C-AGENT-009"]
      }
    ]
  },
  "nextCalls": [
    {
      "tool": "memory.get",
      "input": {
        "id": "I-MEMORY-021"
      }
    }
  ]
}
```

The report intentionally does not mutate records and does not include full
memory bodies. Use it to decide what to inspect, split, archive, or consolidate.

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
  "knownFaults": [],
  "recentEvents": [],
  "summary": "Use this context before editing files. Treat knownFaults as stop-signals before repeating an approach."
}
```

Preflight should include:

* task
* project
* active project decisions
* active common rules
* items matching task title/scope
* failed attempts matching task title/scope
* known faults matching task title/scope
* recent events for the project
* dependencies if any

`knownFaults` is currently an alias of `failedAttempts` for clearer agent
behavior. Keep reading `failedAttempts` for backward compatibility.

---

### `preflight.by_query`

Return preflight-like context before a task exists.

Input:

```json
{
  "project": "project-memory-mcp",
  "query": "add artifact lifecycle archive support",
  "includeCommon": true,
  "limits": {
    "decisions": 10,
    "items": 10,
    "failedAttempts": 5,
    "artifacts": 5,
    "events": 10
  }
}
```

Output:

```json
{
  "project": {
    "id": "P-MEMORY",
    "slug": "project-memory-mcp"
  },
  "query": "add artifact lifecycle archive support",
  "relevantDecisions": [],
  "commonRules": [],
  "relatedItems": [],
  "failedAttempts": [],
  "knownFaults": [],
  "artifacts": [],
  "recentEvents": [],
  "summary": "Use this shared query context before creating a task or editing files. Treat knownFaults as stop-signals before repeating an approach."
}
```

Use this when an agent is asked to explore or start ad-hoc work before a formal
task exists. Once scope becomes executable, create a task and use `preflight`.
If `knownFaults` contains a matching record, do not repeat that approach without
choosing a different next step or asking for direction.

---

### `context.pack`

Return a compact token-conscious start-of-work package for a task or query.

Use this before full `preflight`, full `memory.get`, `artifact.read_text`, or
`artifact.get(includeContent=true)` when the agent needs a quick orientation
without loading complete bodies or base64 content.

Input by query:

```json
{
  "query": "add compact context retrieval",
  "project": "project-memory-mcp",
  "mode": "brief",
  "profile": "implement",
  "tokenBudget": 1500,
  "includeCommon": true
}
```

Input by task:

```json
{
  "taskId": "T-MEMORY-016",
  "mode": "normal",
  "profile": "implement"
}
```

`mode` may be `brief`, `normal`, or `deep`. It controls default result limits.
`profile` may be `general`, `implement`, `review`, `deploy`, `chatgpt`, or
`onboarding`.

Output:

```json
{
  "summary": "Compact start-of-work context...",
  "budget": {
    "mode": "brief",
    "profile": "implement",
    "tokenBudget": 1500,
    "strategy": "compact-cards",
    "fullBodiesIncluded": false,
    "base64Included": false,
    "estimatedChars": 4200
  },
  "project": {
    "id": "P-MEMORY",
    "slug": "project-memory-mcp",
    "title": "Project Memory MCP"
  },
  "task": null,
  "mustRead": [
    {
      "kind": "failed_attempt",
      "id": "I-MEMORY-011",
      "tool": "memory.get",
      "reason": "Known fault matched this task/query..."
    }
  ],
  "handoffs": [],
  "decisions": [],
  "knownFaults": [],
  "memory": [],
  "artifacts": [
    {
      "id": "A-COMMON-013",
      "path": "conventions/PROJECT_MEMORY_COLLABORATION.md",
      "preferredNextTool": "artifact.read_text"
    }
  ],
  "recentEvents": [],
  "nextCalls": [
    {
      "tool": "artifact.read_text",
      "input": { "id": "A-COMMON-013" },
      "reason": "Read bounded text from shared artifact without loading base64 content."
    }
  ]
}
```

`context.pack` intentionally returns compact cards and next-call pointers. It
does not include full record bodies or artifact base64 content.

---

### `context.changed_since`

Return compact changes after a timestamp cursor.

Input:

```json
{
  "project": "project-memory-mcp",
  "since": "2026-06-20T14:30:00.000Z",
  "includeCommon": true,
  "limit": 20
}
```

Use `"project": null` for common-only changes. Omit `project` to use the
requesting client's current project. Store the returned `nextCursor` and pass it
as `since` on the next refresh.

Output:

```json
{
  "since": "2026-06-20T14:30:00.000Z",
  "nextCursor": "2026-06-20T14:47:12.880Z",
  "project": {
    "id": "P-MEMORY",
    "slug": "project-memory-mcp"
  },
  "counts": {
    "tasks": 1,
    "memory": 2,
    "handoffs": 1,
    "decisions": 0,
    "artifacts": 1,
    "events": 5
  },
  "changes": {
    "tasks": [],
    "memory": [],
    "handoffs": [],
    "decisions": [],
    "artifacts": [],
    "events": []
  },
  "nextCalls": []
}
```

The response is an incremental compact refresh. It omits full memory bodies and
artifact base64 content; use `nextCalls` only for records that need detail.

---

### `handoff.create`

Create a compact shared handoff for another agent.

Input:

```json
{
  "project": "project-memory-mcp",
  "taskId": "T-MEMORY-003",
  "title": "Artifact lifecycle implementation handoff",
  "workCompleted": [
    "Added artifact archive lifecycle migration.",
    "Added artifact.list navigation tool."
  ],
  "filesTouched": [
    "src/gateway/pg-tool-service.ts",
    "migrations/pg/003_artifact_lifecycle.cjs"
  ],
  "blockers": [],
  "validation": [
    "npm run typecheck",
    "npm run smoke:gateway:mcp-http"
  ],
  "nextSteps": [
    "Run pm3m migrate latest before deploying the updated gateway package."
  ],
  "tags": ["handoff", "artifacts"]
}
```

Output:

```json
{
  "handoff": {
    "id": "I-MEMORY-010",
    "type": "handoff",
    "title": "Artifact lifecycle implementation handoff"
  },
  "event": {
    "type": "handoff.created",
    "relatedId": "I-MEMORY-010"
  },
  "link": {
    "relation": "relates_to",
    "toId": "T-MEMORY-003"
  }
}
```

Behavior:

* stores the handoff as `type="handoff"` memory
* formats sections for completed work, files touched, blockers, validation, and
  next steps
* records a `handoff.created` event
* links to `taskId` with `relates_to` when provided

Use this before switching agents, pausing work, or leaving a compact continuation
point after meaningful changes.

---

### `handoff.latest`

Return recent handoffs for the current/project/common scope.

Input:

```json
{
  "project": "project-memory-mcp",
  "includeCommon": true,
  "includeContent": false,
  "limit": 3
}
```

Use `"project": null` for common-only handoffs. Omit `project` to use the
requesting client's current project.

Output:

```json
{
  "handoffs": [
    {
      "id": "I-MEMORY-010",
      "title": "Project Memory OAuth facade for ChatGPT Apps",
      "excerpt": "Work completed: ...",
      "tags": ["handoff", "oauth"],
      "updatedAt": "2026-06-20T13:22:21.278Z"
    }
  ]
}
```

By default the response is compact and omits full `body`. Pass
`includeContent=true` only when the full handoff body is needed.

---

### `handoff.search`

Search handoffs by topic.

Input:

```json
{
  "project": "project-memory-mcp",
  "query": "OAuth facade ChatGPT Apps",
  "includeCommon": true,
  "includeContent": false,
  "limit": 10
}
```

Output is the same compact handoff shape as `handoff.latest`. Use this before
broad `memory.search` when the agent needs a continuation summary.

## Seed tools or scripts

MVP can use scripts instead of MCP tools for seeding.

Recommended scripts:

```bash
npm run seed:common
npm run seed:templates
pm3m seed templates
```

`pm3m migrate latest` runs the bundled template seed automatically on the
gateway after PostgreSQL migrations. Client agents do not seed templates
locally; they search the gateway artifact store.

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
