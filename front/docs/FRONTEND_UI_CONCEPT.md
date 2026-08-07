# Project Memory UI Concept

Audience: frontend agent implementing a future Project Memory web UI.

This document is a product and implementation concept, not a current MVP
requirement. The existing pmem gateway remains the source of truth. The UI must
make shared memory observable and safer to operate; it must not become a generic
note-taking application.

## Goal

Build a quiet operational dashboard for developers and agents who need to
understand what pmem knows before changing code.

The UI should answer these questions quickly:

- Which projects exist, and which one am I looking at?
- What tasks, decisions, faults, handoffs, artifacts, and recent events define
  the current state?
- What changed recently?
- What knowledge is project-specific, and what is common/shared?
- Which records are safe to inspect, edit, archive, or delete?
- What should an agent read before starting work?

The UI is for browsing, triage, and controlled maintenance. Agents still use MCP
tools for execution workflows.

## Product Shape

Use an application layout, not a landing page.

Preferred structure:

- left navigation rail: Projects, Common, Tasks, Decisions, Faults, Artifacts,
  Events, Clients, Diagnostics
- top bar: project selector, global search, connection/status indicator
- main content: dense tables and split-detail views
- right detail drawer: selected record details, related records, next actions

The visual tone should be utilitarian and calm: high information density,
subtle separators, predictable tables, readable timestamps, compact badges, and
clear destructive-action confirmation. Avoid marketing-style hero sections,
large decorative cards, gradients, and illustrative empty states.

## Primary Workflows

### 1. First Open

Show a gateway status page if the API is unreachable or unauthorized.

If connected:

1. Load `gateway.version` / diagnostics.
2. Load project list.
3. Select current project if available.
4. Show project summary for the selected project.

The first screen should be useful without configuration: project list on the
left, selected project summary in the center, recent events on the right.

### 2. Project Overview

Project overview is the main screen.

Show:

- compact project identity: id, slug, title, status, root path
- counts: open tasks, decisions, known faults, artifacts, memory items, events
- open tasks ordered by status and priority
- active decisions
- known faults as stop-signals
- latest handoffs
- relevant artifacts
- recent events timeline

Use `project.summary` or equivalent GraphQL aggregation as the default data
source. Do not load every full record body on page open.

### 3. Search And Inspect

Global search should search memory and artifacts together but display them in
separate result groups.

Search result cards must be compact:

- type
- id
- scope
- title/path
- status
- tags
- short excerpt
- preferred next action

Clicking a result opens the detail drawer. Full body or artifact text should be
loaded lazily only when the user opens the record.

### 4. Task Operations

Tasks should feel like executable work, not generic notes.

Task list columns:

- id
- title
- status
- priority
- milestone
- updated
- related faults count

Task detail should show:

- scope
- acceptance criteria
- allowed files
- forbidden files
- dependencies
- notes
- related memory
- preflight preview
- event history

Supported actions:

- create task
- update status
- delete task by id after explicit confirmation
- copy task id

For `task.delete`, require a confirmation dialog that shows task id/title and
states that the operation is hard delete.

### 5. Decisions

Decisions are first-class constraints.

Decision list columns:

- id
- title
- status
- scope
- tags
- updated

Decision detail should show:

- context
- decision
- rationale
- consequences
- supersedes/superseded-by links

Use status badges: active, draft, superseded, rejected.

### 6. Known Faults

Known faults are operational stop-signals.

They should be visually distinct from normal memory records. Use a restrained
warning treatment, not an alarm-heavy design.

Detail should show:

- what was tried
- why it failed
- do not repeat
- better next approach
- related task/project/entity

Faults should appear in project overview, preflight views, and task detail.

### 7. Artifacts

Artifacts are shared files stored on the gateway.

Artifact list columns:

- id
- path
- scope
- content type
- size
- status
- tags
- updated

Text artifacts:

- use `artifact.peek` for list previews
- use `artifact.read_text` for full bounded text
- show outline for Markdown

Binary artifacts:

- show metadata and download action
- do not inline base64

Actions:

- upload text artifact
- upload binary artifact
- update metadata
- archive
- download

Use `artifact.put_text` for Markdown/text uploads and reserve base64 upload for
binary files.

### 8. Events Timeline

Events are append-only history.

Timeline filters:

- project/common
- type
- related id
- date range

Each event should show:

- timestamp
- type
- title
- related id
- actor/source when available

Use event timeline to explain why records changed.

### 9. Clients And Gateway Diagnostics

Gateway operations page should show:

- package version
- storage mode
- tool count
- readiness
- migrations
- artifact settings
- logging settings
- known clients

Client management:

- list clients
- inspect one client
- forget stale client
- prune stale anonymous clients with dry-run first

Do not expose secrets.

### 10. Delete And Prune UX

Deletion is dangerous because pmem is shared team memory.

Rules:

- `task.delete` requires explicit user confirmation.
- `project.delete` requires explicit user confirmation.
- `project.delete` without `cascade=true` should be the default first attempt.
- If the backend returns `PROJECT_NOT_EMPTY`, show dependency counts and ask
  whether to cascade.
- `cascade=true` confirmation must require typing the project slug.
- Show affected counts before cascade delete.
- After successful delete, invalidate project/task lists and current-project
  state.

Never hide destructive actions inside row hover-only controls. Use visible
toolbar actions in detail views.

## Data Model In The UI

Represent records by stable ids.

Core entity types:

- Project
- Task
- MemoryItem
- Decision
- Event
- Link
- Artifact
- GatewayClient
- DiagnosticStatus

Scope should be explicit:

- `project`
- `common`

Project-specific knowledge should visually outrank common knowledge in mixed
views.

## GraphQL Boundary

The UI stack requested for this frontend is React, TypeScript, Vite, Zustand,
and GraphQL.

Do not call PostgreSQL directly from the browser. Add a server-side GraphQL
gateway in front of the existing pmem service layer or MCP/gateway API.

Recommended shape:

```text
Browser React app
  -> GraphQL API
    -> pmem gateway service / HTTP tool calls
      -> PostgreSQL + artifact storage
```

GraphQL should expose user-oriented queries and mutations, not raw MCP transport
objects.

Suggested queries:

```graphql
query Projects($status: ProjectStatus) {
  projects(status: $status) {
    id
    slug
    title
    status
    rootPath
    updatedAt
  }
}

query ProjectOverview($project: String!, $query: String) {
  projectSummary(project: $project, query: $query) {
    project { id slug title status description }
    counts { tasks openTasks items decisions artifacts events }
    openTasks { id title status priority }
    decisions { id title status }
    knownFaults { id title excerpt }
    artifacts { id path title contentType preferredNextTool }
    recentEvents { id type title relatedId createdAt }
  }
}

query Search($project: String, $query: String!) {
  memorySearch(project: $project, query: $query) { id type title scope excerpt tags }
  artifactSearch(project: $project, query: $query) { id path title scope contentType tags }
}
```

Suggested mutations:

```graphql
mutation DeleteTask($id: ID!, $reason: String) {
  deleteTask(id: $id, reason: $reason) {
    deletedTask { id title projectId }
    event { id type createdAt }
  }
}

mutation DeleteProject($id: ID, $slug: String, $cascade: Boolean!, $reason: String) {
  deleteProject(id: $id, slug: $slug, cascade: $cascade, reason: $reason) {
    deletedProject { id slug title }
    cascade
    counts { tasks items decisions links events artifacts currentProjectKeys }
  }
}
```

GraphQL resolvers should normalize backend errors into typed UI errors:

- `UNAUTHORIZED`
- `PROJECT_NOT_FOUND`
- `PROJECT_NOT_EMPTY`
- `TASK_NOT_FOUND`
- `ARTIFACT_CONFLICT`
- `VALIDATION_ERROR`
- `DB_ERROR`

## Frontend Architecture

Use feature-oriented structure:

```text
src/
  app/
    App.tsx
    router.tsx
    providers/
  features/
    projects/
    tasks/
    decisions/
    memory/
    artifacts/
    events/
    clients/
    diagnostics/
    search/
  shared/
    api/
    ui/
    model/
    dates/
    formatting/
```

Dependency direction:

```text
app -> features -> shared
```

Use generated GraphQL types if practical. Avoid broad `any`.

## Zustand State

Use Zustand for UI state, not as a replacement for server cache.

Good Zustand state:

- selected project id/slug
- selected record id/type
- active filters
- table sort settings
- drawer open/closed state
- destructive confirmation state
- recent search query
- display density

Server data should come from GraphQL query cache. If Apollo Client is used, do
not duplicate normalized server records in Zustand.

Suggested stores:

```text
useWorkspaceStore
  selectedProject
  selectedRecord
  detailDrawerOpen

useFilterStore
  taskFilters
  decisionFilters
  artifactFilters
  eventFilters

useConfirmStore
  pendingAction
  confirmationInput
```

## UI Components

Reusable shared components:

- `DataTable`
- `StatusBadge`
- `ScopeBadge`
- `TagList`
- `Timestamp`
- `RecordId`
- `EmptyState`
- `ConfirmDialog`
- `DetailDrawer`
- `MarkdownPreview`
- `SearchBox`
- `SplitPane`

Prefer tables and split-detail layouts over card grids. Cards are acceptable
for compact summary widgets and repeated search result items, but keep radius
small and information dense.

## Routes

Suggested routes:

```text
/                         redirect to /projects or last project
/projects                 project list
/projects/:slug           project overview
/projects/:slug/tasks     tasks
/projects/:slug/decisions decisions
/projects/:slug/faults    known faults
/projects/:slug/artifacts artifacts
/projects/:slug/events    events
/common                   common knowledge
/clients                  gateway clients
/diagnostics              gateway diagnostics
```

Record detail can be query-param driven:

```text
/projects/project-memory-mcp?record=task:T-MEMORY-001
```

This makes links shareable without building too many detail routes.

## Performance Rules

- Default views must use compact summaries.
- Full memory bodies load on demand.
- Artifact content loads on demand.
- Never request base64 content for previews.
- Paginate lists.
- Debounce search input.
- Keep GraphQL queries scoped by project whenever possible.
- Use `context.changed_since` semantics for incremental refresh if exposed in
  GraphQL.

## Safety Rules

- Do not show secrets from logs or artifact text if backend redaction is
  available.
- Do not add role/ACL UI until backend supports roles/ACLs.
- Do not imply per-user permissions exist; current gateway auth is trusted
  internal token access.
- Do not add embeddings/vector search controls unless backend implements them.
- Do not build graph visualization as the primary UX. A relationship graph may
  be a later secondary view, but tables and timelines should come first.

## Implementation Phases

### Phase 1: Read-Only Explorer

- Vite + React + TypeScript app shell
- GraphQL client setup
- gateway status/diagnostics
- project list
- project overview
- task/decision/artifact/event read-only lists
- detail drawer

### Phase 2: Search And Context

- global search
- project summary refresh
- preflight/context pack preview
- artifact peek/read text
- Markdown outline display

### Phase 3: Controlled Mutations

- task status update
- task create
- task delete
- artifact metadata update/archive
- project delete with `PROJECT_NOT_EMPTY` handling and cascade confirmation
- gateway client forget/prune with dry-run

### Phase 4: Collaboration Signals

- recent changes
- handoff views
- actor/source display
- stale client cleanup
- changed-since polling

## Acceptance Criteria For The Frontend Agent

The first useful frontend milestone is complete when:

- a developer can connect to a pmem gateway
- project list loads
- selecting a project shows a compact overview
- tasks, decisions, artifacts, and events are browseable
- record detail opens without full page reload
- global search returns memory and artifact results
- artifact text can be read without base64
- destructive actions require explicit confirmation
- UI handles `PROJECT_NOT_EMPTY` clearly
- layout works at desktop and laptop widths
- important flows are covered by tests or browser smoke checks

Do not implement features outside the backend contract just to make the UI look
complete. Missing backend capabilities should be shown as disabled or absent,
not mocked as real behavior.
