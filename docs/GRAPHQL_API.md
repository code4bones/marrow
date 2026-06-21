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

Project overview:

```graphql
query ProjectOverview($project: String!) {
  projectSummary(project: $project) {
    project { id slug title status }
    counts { tasks openTasks items decisions artifacts events }
    openTasks { id title status priority }
    decisions { id title status decision }
    knownFaults { id title excerpt tags }
    artifacts { id path title contentType sizeBytes preferredNextTool }
    recentEvents { id type title relatedId createdAt }
    nextCalls { tool input reason }
  }
}
```

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

## Available Mutations

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

Task deletion:

```graphql
mutation DeleteTask($id: ID!) {
  deleteTask(id: $id, reason: "Removed after explicit user confirmation") {
    deletedTask { id title }
    event { id type createdAt }
  }
}
```

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
- Treat `gatewayStatus`, `gatewayVersion`, and `gatewayDiagnostics` as JSON
  scalars for diagnostics views.
- Use destructive mutations only after explicit UI confirmation.
- For `deleteProject`, try `cascade=false` first and display
  `PROJECT_NOT_EMPTY` details before allowing cascade delete.
- Subscriptions are intentionally not part of the current GraphQL slice. Add
  them only after choosing the concrete transport and reconnect semantics.

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
