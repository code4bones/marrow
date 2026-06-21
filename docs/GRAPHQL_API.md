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
queries, operations, and future mutation/subscription traffic:

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

The first implementation is read-oriented and maps to existing gateway tools.
Resolvers call `PgToolService.call()` so validation, project resolution,
artifact text handling, and gateway client tracking stay centralized.

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

## Frontend Rules

- Use `projectSummary` as the default project overview query.
- Use `artifactText` for Markdown/text content.
- Do not request base64 for text previews or reads.
- Keep GraphQL queries scoped by project where practical.
- Treat `gatewayStatus`, `gatewayVersion`, and `gatewayDiagnostics` as JSON
  scalars for diagnostics views.
- Destructive mutations and subscriptions are intentionally not part of the
  first GraphQL slice. Add them only with explicit UI confirmation flows, OAuth
  write-scope handling for mutations, and a concrete transport choice for
  subscriptions.

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
