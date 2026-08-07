# Gateway GraphQL API

The shared gateway exposes a browser-facing GraphQL endpoint for the future
PMemUI frontend:

```text
POST /graphql
GET  /graphql
OPTIONS /graphql
```

Behind the public `/api` nginx prefix, the frontend-facing URL is:

```text
${GW_ENDPOINT}/graphql
```

For production this is:

```text
https://pmem.undoo.ru/api/graphql
```

The direct gateway also accepts `${API_ENDPOINT}/graphql` when `API_ENDPOINT`
is set, so local checks can exercise the same public path shape.

The endpoint runs in the same gateway process as `/mcp`, `/call`, OAuth, and
artifact downloads. It uses the same gateway authorization for GraphQL Sandbox,
queries, operations, and mutation traffic:

```http
Authorization: Bearer <MCP_TOKEN or OAuth access token>
```

Client identity can be passed with the same headers used by HTTP tool calls:

```http
X-Project-Memory-Client-ID: developer-or-agent-id
X-Project-Memory-Client-Label: Readable label
X-Project-Memory-Client-Kind: frontend
```

## Purpose

GraphQL is the browser-facing API boundary for PMemUI. The frontend should call
`${GW_ENDPOINT}/graphql`, not PostgreSQL and not MCP transport directly.

Resolvers map to existing gateway tools through `PgToolService.call()` so
validation, project resolution, artifact text handling, event recording, and
gateway client tracking stay centralized.

GraphQL `query` operations require `memory:read` for OAuth tokens. GraphQL
`mutation` operations require both `memory:read` and `memory:write`. Static
gateway bearer tokens from `.env` continue to authorize all operations.

## Available Queries

Gateway:

```graphql
query Gateway {
  gatewayStatus
  gatewayVersion
  gatewayDiagnostics
}
```

Gateway clients can be fetched as a bounded list or as a paginated table:

```graphql
query GatewayClientsTable {
  gatewayClientsPage(pagination: { limit: 25, offset: 0 }) {
    items { id label lastSeenAt metadata }
    pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
  }
}
```

Projects:

```graphql
query Projects {
  projects(status: "active") {
    id
    slug
    title
    status
    rootPath
    updatedAt
  }
}
```

Paginated project table:

```graphql
query ProjectsTable {
  projectsPage(status: "active", pagination: { limit: 25, offset: 0 }) {
    items { id slug title status updatedAt }
    pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
  }
}
```

Project overview:

```graphql
query ProjectOverview($project: String!) {
  projectSummary(project: $project) {
    project { id slug title status }
    counts { tasks openTasks items decisions links artifacts events }
    openTasks { id title status priority }
    decisions { id title status decision }
    knownFaults { id title excerpt tags }
    artifacts { id path title contentType sizeBytes preferredNextTool }
    recentEvents { id type title relatedId createdAt }
    nextCalls { tool input reason }
  }
}
```

Record navigation by identifier:

```graphql
query RecordDetails($id: ID!) {
  record(id: $id) {
    id
    kind
    projectId
    record {
      __typename
      ... on Task { id title status scope acceptance notes }
      ... on MemoryRecord { id scope type title body status tags updatedAt }
      ... on Decision { id title status context decision rationale consequences }
      ... on Artifact { id path title contentType sizeBytes downloadPath }
      ... on Event { id type title body relatedId createdAt }
      ... on Link { id fromId toId relation createdAt }
      ... on Project { id slug title status rootPath }
    }
  }
}
```

Use `record(id)` for clickable IDs such as `T-PMEM-004`, `I-MEMORY-015`,
`L-MEMORY-011`, `E-MEMORY-156`, or `A-COMMON-003`. The `kind` field tells the UI
which detail panel to render, and GraphQL fragments provide the record content.
For text artifacts, use `artifactText(id: "...")` after resolving the artifact
metadata; binary artifacts should use `downloadPath`.

Artifact text:

```graphql
query ArtifactText($project: String!, $path: String!) {
  artifactText(project: $project, path: $path, maxBytes: 65536) {
    id
    path
    text
    textInfo {
      readBytes
      truncated
      redacted
      base64Included
    }
    outline { level title line }
  }
}
```

Search and lists:

```graphql
query Search($project: String!, $query: String!) {
  memorySearch(project: $project, query: $query, includeCommon: true) {
    id
    scope
    type
    title
    excerpt
    tags
  }
  artifactSearch(project: $project, query: $query, includeCommon: true) {
    id
    scope
    path
    title
    contentType
    preferredNextTool
  }
}
```

Paginated table fields are available for the main PMemUI grids:

```graphql
query ProjectTables($project: String!) {
  tasksPage(project: $project, pagination: { limit: 25, offset: 0 }) {
    items { id title status priority activeClaimCount updatedAt }
    pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
  }

  decisionsPage(project: $project, includeCommon: true, pagination: { limit: 25, offset: 0 }) {
    items { id title status updatedAt }
    pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
  }

  memoryItemsPage(project: $project, includeCommon: true, pagination: { limit: 25, offset: 0 }) {
    items { id scope type title status tags updatedAt }
    pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
  }

  artifactsPage(project: $project, pagination: { limit: 25, offset: 0 }) {
    items { id path title contentType sizeBytes updatedAt }
    pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
  }

  linksPage(project: $project, includeCommon: true, pagination: { limit: 25, offset: 0 }) {
    items { id projectId fromId toId relation createdAt }
    pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
  }

  eventsPage(project: $project, pagination: { limit: 50, offset: 0 }) {
    items { id type title relatedId createdAt }
    pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
  }
}
```

Use `memoryItemsPage` for the raw `I-*` table. Use `memorySearchPage` when the
user typed a search query and ranked excerpts are useful. Use `linksPage` for
the raw `L-*` table, or `links(id: "...")` to show relationships around one
record.

Task claims:

```graphql
query TaskClaims($taskId: ID!) {
  task(id: $taskId) {
    id
    status
    activeClaimCount
  }
  taskClaims(taskId: $taskId, includeInactive: true) {
    id
    role
    scope
    status
    clientLabel
    leaseExpiresAt
    heartbeatAt
  }
}
```

Use `activeClaimCount` in task tables to show collaborative activity without
loading full claim history for every row. Open the task detail drawer and call
`taskClaims` when the user needs to see who is working on the task.

Project graph:

```graphql
query ProjectGraph($projectId: ID!) {
  projectGraph(projectId: $projectId, depth: 2, maxPerType: 60) {
    nodes {
      id
      kind
      title
      status
      createdAt
    }
    edges {
      from
      to
      relation
    }
  }
}
```

`projectGraph` returns project-scoped nodes plus real related endpoints up to
the requested depth. Edges come from stored links, task dependencies
(`blocks`), and decision supersession (`supersedes`). Click any node with
`record(id)` to open the shared detail drawer. `createdAt` (added for
I-PMEM-011's horizontal timeline view) is always present, including on the
PROJECT node.

Events are deliberately excluded from this graph (I-MEMORY-022 step 3):
they're operational bookkeeping (`item.created`, `link.created`, ...), not
curated knowledge edges, and measured at ~80% of graph nodes on real project
data — drowning out the handful of real semantic links. Use `events`/
`eventsPage` for the operational timeline instead. `maxPerType` (default 60)
caps how many items/tasks/decisions/artifacts are pulled in per type, most
recently updated first, so one prolific type can't flood the response either.

Search result tables also have paginated variants:

```graphql
query SearchTables($project: String!, $query: String!) {
  memorySearchPage(project: $project, query: $query, includeCommon: true, pagination: { limit: 25, offset: 0 }) {
    items { id scope type title excerpt tags }
    pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
  }

  artifactSearchPage(project: $project, query: $query, includeCommon: true, pagination: { limit: 25, offset: 0 }) {
    items { id scope path title contentType preferredNextTool }
    pageInfo { limit offset totalCount hasNextPage hasPreviousPage }
  }
}
```

## Pagination

PMemUI table queries use offset pagination for the first frontend slice:

```graphql
input PaginationInput {
  limit: Int = 50
  offset: Int = 0
}

type PageInfo {
  limit: Int!
  offset: Int!
  totalCount: Int!
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
}
```

Each paginated field returns:

```graphql
type PaginatedTasks {
  items: [Task!]!
  pageInfo: PageInfo!
}
```

The gateway executes pagination at PostgreSQL level with `COUNT(*)`,
`LIMIT`, and `OFFSET`. `limit` is bounded server-side. This shape is chosen for
PMemUI data grids because the frontend can show total rows, page size, current
page, and next/previous controls without guessing.

Keep existing non-paginated list fields for compact agent workflows and simple
selectors. Use `*Page` fields for UI tables.

## Available Mutations

Project, memory, task, decision, link, event, and artifact lifecycle mutations
are available for PMemUI maintenance screens. Most mutations require `write`
scope; the seven hard-delete mutations require `admin` scope instead (see
"Authorization and scope errors" below) and should be guarded by explicit UI
confirmation regardless of scope.

Memory lifecycle:

```graphql
mutation MemoryMaintenance($project: String!, $id: ID!) {
  createMemory(input: {
    project: $project
    type: "note"
    title: "Useful context"
    body: "Details for future agents."
    tags: ["frontend"]
    summary: "One-line TL;DR, preferred over KWIC/truncation in memorySearch excerpts"
    links: [{ toId: "D-MEMORY-013", relation: "relates_to" }]
  }) {
    id
    title
    status
    summary
    linksCreated { id fromId toId relation }
    relatedCandidates { id type title }
  }

  updateMemory(input: {
    id: $id
    status: "archived"
  }) {
    id
    status
  }

  archiveMemory(id: $id, reason: "No longer relevant") {
    action
    memory { id status }
    event { id type }
  }

  deleteMemory(id: $id, reason: "Explicit user-confirmed cleanup") {
    deletedMemory { id title }
    deletedLinks
    event { id type }
  }
}
```

Project and task lifecycle:

```graphql
mutation TaskStatus($id: ID!) {
  updateTaskStatus(id: $id, status: "doing", note: "Started from PMemUI") {
    id
    status
    updatedAt
  }
}
```

Task claim lifecycle:

```graphql
mutation ClaimTask($taskId: ID!) {
  claimTask(input: {
    taskId: $taskId
    role: "frontend"
    scope: "Build task dependency flowchart"
    leaseSeconds: 3600
  }) {
    claim { id status role leaseExpiresAt }
    task { id status activeClaimCount }
  }
}

mutation AddTaskTrace($taskId: ID!) {
  addTaskNote(input: {
    taskId: $taskId
    type: "implementation_note"
    body: "Implemented the flowchart view and wired record(id) click-through."
  }) {
    item { id type title }
    link { id fromId toId relation }
  }
}

mutation CompleteClaimedTask($taskId: ID!, $claimId: ID!) {
  completeTask(
    id: $taskId
    claimId: $claimId
    acceptanceEvidence: "Frontend smoke passed and no active claims remain."
  ) {
    task { id status activeClaimCount }
    completedClaim { id status }
    event { id type }
  }
}
```

`completeTask` does not auto-close from claim count. It refuses to close while
other active claims remain unless `force=true` is supplied with a reason or
acceptance evidence.

Task deletion:

```graphql
mutation DeleteTask($id: ID!) {
  deleteTask(id: $id, reason: "Removed after explicit user confirmation") {
    deletedTask { id title }
    deletedLinks
    event { id type createdAt }
  }
}
```

Decision lifecycle:

```graphql
mutation DecisionMaintenance($project: String!, $id: ID!) {
  recordDecision(input: {
    project: $project
    title: "Use record(id) for PMemUI detail navigation"
    decision: "Clickable IDs resolve through the generic record lookup."
    tags: ["frontend", "graphql"]
  }) {
    id
    status
  }

  archiveDecision(id: $id, reason: "Superseded by architecture update") {
    action
    decision { id status }
    event { id type }
  }

  deleteDecision(id: $id, reason: "Explicit user-confirmed cleanup") {
    deletedDecision { id title }
    deletedLinks
    event { id type }
  }
}
```

`supersedeDecision` creates a replacement decision and supersedes the old one
in one call — the same workflow as the `decision.supersede` MCP tool, just
exposed to GraphQL clients (added for PMemUI's timeline "create a connected
decision" action):

```graphql
mutation SupersedeDecision($project: String!, $supersedesId: String!) {
  supersedeDecision(input: {
    project: $project
    supersedesId: $supersedesId
    title: "Use PostgreSQL for shared gateway storage"
    decision: "..."
    rationale: "Required — the replacement decision explains why the old one no longer holds."
  }) {
    decision { id status supersedesId }
    superseded { id status }
    link { fromId toId relation }
    event { type }
  }
}
```

Its input reuses `RecordDecisionInput`'s GraphQL shape; `supersedesId` and
`rationale` are enforced as required by the underlying MCP tool's schema
(decision.supersede), not by GraphQL nullability — matches how `rationale`
is optional on plain `recordDecision` but required here.

Text artifact upload:

```graphql
mutation PutTextArtifact($input: PutTextArtifactInput!) {
  putTextArtifact(input: $input) {
    id
    path
    title
    contentType
    sizeBytes
  }
}
```

Artifact metadata and archive:

```graphql
mutation ArchiveArtifact($id: ID!) {
  updateArtifactMetadata(input: {
    id: $id
    title: "Updated title"
    tags: ["docs", "frontend"]
  }) {
    id
    title
    tags
  }

  archiveArtifact(id: $id, reason: "Superseded by a newer artifact") {
    action
    artifact { id status archivedAt }
    event { id type createdAt }
  }

  deleteArtifact(id: $id, reason: "Explicit user-confirmed cleanup") {
    deletedArtifact { id path }
    deletedLinks
    event { id type }
  }
}
```

Links and events:

```graphql
mutation LinkAndEventMaintenance($project: String!, $fromId: String!, $toId: String!, $linkId: ID!, $eventId: ID!) {
  createLink(input: {
    project: $project
    fromId: $fromId
    toId: $toId
    relation: "documents"
  }) {
    id
    relation
  }

  deleteLink(id: $linkId, reason: "Explicit user-confirmed cleanup") {
    deletedLink { id fromId toId relation }
    event { id type }
  }

  recordEvent(input: {
    project: $project
    type: "ui.note"
    title: "Useful UI timeline note"
  }) {
    id
    type
  }

  deleteEvent(id: $eventId, reason: "Remove test event") {
    deletedEvent { id type }
  }
}
```

Project delete:

```graphql
mutation DeleteProject($slug: String!) {
  deleteProject(
    slug: $slug
    cascade: false
    reason: "Explicit user-confirmed cleanup"
  ) {
    deletedProject { id slug title }
    cascade
    counts { tasks items decisions links events artifacts currentProjectKeys }
  }
}
```

## Frontend Rules

- Use `projectSummary` as the default project overview query.
- Use `artifactText` for Markdown/text content.
- Do not request base64 for text previews or reads.
- Keep GraphQL queries scoped by project where practical.
- Use `*Page` fields for PMemUI tables that need page size and total row count.
- Treat `gatewayStatus`, `gatewayVersion`, and `gatewayDiagnostics` as JSON
  scalars for diagnostics views.
- Use destructive mutations only after explicit UI confirmation.
- Prefer archive mutations for durable knowledge; use hard-delete for explicit
  cleanup, test data removal, or records the user intentionally wants removed.
- Hard-delete mutations remove relationship links that point at the deleted
  record and return `deletedLinks` where applicable.
- For `deleteProject`, try `cascade=false` first and display
  `PROJECT_NOT_EMPTY` details before allowing cascade delete.

## Subscriptions (T-MEMORY-042): live updates over WS

One field, `gatewayEvents`, is the entire live-update surface -- deliberately
not per-entity-type subscriptions (owner decision). Every mutation across
every domain (project/memory/task/decision/artifact/link/event) already
passes through `PgToolService.recordEventForProject()`
(`src/gateway/pg-tool-service.ts`), so hooking a single publish there covers
the whole gateway with no other call site needing to change. The in-process
fan-out is `src/gateway/event-bus.ts`'s `gatewayEvents` (a
`graphql-subscriptions` `PubSub` singleton); the WS transport is
`graphql-ws`'s `useServer` (`graphql-ws/use/ws`) wired into the same
`node:http` server `startGatewayServer` already runs, via one `"upgrade"`
handler (`src/gateway/http-server.ts`) -- there is no separate WS port.

```graphql
type GatewayEventEnvelope {
  event: String!
  payload: JSON!
}

type Subscription {
  gatewayEvents: GatewayEventEnvelope!
}
```

`event` mirrors the underlying `events.type` column (e.g. `"item.created"`,
`"task.updated"`, `"decision.archived"`). `payload` is exactly `eventOut()`'s
shape -- the same fields `event.list`/`event.get`/`Event` already expose over
HTTP (`id`, `projectId`, `type`, `title`, `body`, `relatedId`, `credentialId`,
`createdAt`). For a mutation like `memory.create`, `payload.relatedId` is the
mutated record's own id (`I-...`); `payload.id` is the event row's own id.
For an `event.record`-created event (including a common-scope one), there is
no separate mutated record, so `payload.id` is the thing itself.

### Connecting

```text
GET/Upgrade ${GW_ENDPOINT}/graphql   (scheme ws:// or wss://)
Sec-WebSocket-Protocol: graphql-transport-ws
```

Same path as the HTTP GraphQL endpoint -- `isGraphqlRequestPath()` decides
which upgrade requests the gateway's WS server takes over; anything else has
its socket destroyed immediately. **Session-cookie auth only.** The `pmem_session`
cookie travels on the WS upgrade request exactly like any other same-origin
HTTP request (browsers attach cookies to the WS handshake automatically), and
`identifyFromRequest()` (`src/gateway/auth.ts`) resolves it the same way it
does for `/auth/*` and `/graphql` HTTP requests. The static `MCP_TOKEN`
bearer and OAuth bearers are **never** accepted for subscriptions -- this is
a PMemUI-only feature, not an agent channel; an MCP agent doesn't need a live
feed of writes it just made itself. A connection with no session, or an
invalid/expired one, is refused inside `graphql-ws`'s `onConnect` callback
(`useServer({ onConnect })` in `http-server.ts`): the socket closes with code
`4403` before the GraphQL-WS handshake ever reaches `connection_ack`.

### Filtering

Every open connection only ever sees the envelopes its own session is
allowed to see, mirroring `assertProjectMember`'s exact bypass rules
(`docs/AUTH.md`'s "Project membership" section, `T-MEMORY-029` /
`D-MEMORY-007`):

- `role=admin` -- sees every envelope, unfiltered.
- A common-scope event (`payload.projectId === null`) -- visible to anyone
  with a subscription, regardless of role.
- `role=member` -- visible only if `(payload.projectId, sessionUserId)` has a
  `project_members` row, exactly the same check `project.get`/
  `memory.search{project}`/etc. already use for REST/MCP/GraphQL queries and
  mutations (`PgToolService.isProjectVisibleToSession()`, extracted from the
  same query `assertProjectMember()` uses).

Filtering happens server-side, per connection, before an envelope is ever
sent down that connection's socket -- a member never receives, queues, or can
observe (even transiently) an envelope for a project it isn't a member of.

### Example

```graphql
subscription LiveFeed {
  gatewayEvents {
    event
    payload
  }
}
```

A client (PMemUI's `GraphQLWsLink` in `apollo.ts`, or any `graphql-ws`
client) opens one subscription to this field and, on each envelope, refetches
whatever query populated the screen currently showing -- the payload is
enough to route ("something in this project changed, of this type") but is
not intended for optimistic cache patching; do a real refetch.

## Authorization and scope errors

See `docs/AUTH.md`'s "Scopes: read / write / admin" section for the full
credential-source-to-scope table (`T-MEMORY-029` / `D-MEMORY-007`). What
matters for GraphQL specifically:

- Every query requires at least `read` scope. Most mutations require
  `write`. Exactly seven mutations require `admin`:
  `deleteProject`, `deleteMemory`, `deleteTask`, `deleteDecision`,
  `deleteArtifact`, `deleteEvent`, `deleteLink` (`ADMIN_GRAPHQL_MUTATION_NAMES`
  in `src/gateway/graphql.ts`). These are the GraphQL counterparts of the
  `*.delete` MCP/REST tools reclassified from `access:"write"` to
  `access:"admin"` in `src/gateway/tool-definitions.ts`.
- The scope check runs on the raw query text before the GraphQL server
  resolves anything: a generic `/\bmutation\b/i` match requires `write`, and
  a second, name-specific match against the list above requires `admin`
  instead. A request mixing an admin-tier mutation with anything else in the
  same document is treated as requiring `admin`.
- An OAuth bearer token (Claude Code / ChatGPT connectors) never satisfies an
  `admin` requirement, regardless of the underlying user's role or what the
  token claims (decision 2) -- it is capped at `read`+`write` forever.
- A request that fails the scope check gets an HTTP-level error, not a
  GraphQL `errors[]` entry -- the check runs before the query reaches the
  GraphQL server at all:

  ```json
  {
    "ok": false,
    "error": {
      "code": "INSUFFICIENT_SCOPE",
      "message": "This operation requires admin scope; your credential has write.",
      "details": { "requiredScope": "admin", "grantedScope": "write" }
    }
  }
  ```

  HTTP status `403` (vs `401` + `AppError` code `UNAUTHORIZED` for a
  missing/invalid credential -- the two are deliberately distinguishable, not
  the same generic error). A request that reaches the resolver but hits a
  domain-level failure (e.g. deleting a record that does not exist) still
  returns its normal GraphQL `errors[]` shape with that operation's own error
  code (e.g. `TASK_NOT_FOUND`), unrelated to scope.

## CORS

`OPTIONS /graphql` and `OPTIONS ${API_ENDPOINT}/graphql` are available for
browser preflight. By default the gateway sets:

```text
Access-Control-Allow-Origin: *
```

Set `GRAPHQL_CORS_ORIGIN` to restrict it for a deployed frontend.

## Validation

Build and run the GraphQL smoke test:

```bash
npm run build
npm run smoke:gateway:graphql
```

The WS subscription transport has its own smoke test against a real
gateway/Postgres instance (admin sees everything, a `role=member` session is
filtered by `project_members`, an unauthenticated upgrade is refused before
`connection_ack`):

```bash
npm run smoke:gateway:subscriptions
```
