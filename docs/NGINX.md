# Project Memory Gateway — Nginx

Use nginx as a reverse proxy in front of the PostgreSQL gateway when several developers or agents need a shared endpoint.

The gateway process should stay bound to localhost:

```text
PROJECT_MEMORY_GATEWAY_HOST=127.0.0.1
PROJECT_MEMORY_GATEWAY_PORT=8765
```

Then include:

```nginx
server {
  server_name memory.example.internal;

  include /absolute/path/to/project-memory-mcp/deploy/nginx/project-memory-gateway.locations.conf;
}
```

Exposed routes:

```text
GET  /project-memory/health
GET  /project-memory/tools
POST /project-memory/call
```

Point stdio gateway clients at the proxied endpoint:

```text
API_ENDPOINT=https://memory.example.internal/project-memory
```

or:

```text
PROJECT_MEMORY_GATEWAY_URL=https://memory.example.internal/project-memory
```

If bearer auth is enabled on the gateway, every client must use the same token:

```text
PROJECT_MEMORY_GATEWAY_TOKEN=...
```

The nginx include forwards `X-Request-ID`, `X-Forwarded-*`, and client IP headers. The gateway logs request ids, status codes, durations, client ids, and tool call completion.
