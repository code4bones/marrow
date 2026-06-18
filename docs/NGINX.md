# Project Memory Gateway — Nginx

Use this only for the internal nginx that sits in front of the local PostgreSQL gateway. External TLS, host routing, and certificates can stay in Nginx Proxy Manager.

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
POST /project-memory/mcp
GET  /project-memory/health
GET  /project-memory/ready
GET  /project-memory/tools
POST /project-memory/call
```

Endpoint meaning:

```text
/health  process is alive
/ready   PostgreSQL is reachable and gateway tables exist
```

Point MCP Streamable HTTP clients at the proxied endpoint:

```text
https://memory.example.internal/project-memory/mcp
```

If your launcher uses `API_ENDPOINT`, set it to the MCP endpoint:

```text
API_ENDPOINT=https://memory.example.internal/project-memory/mcp
```

If bearer auth is enabled on the gateway, every client must use the same token:

```text
PROJECT_MEMORY_GATEWAY_TOKEN=...
```

The nginx include forwards `X-Request-ID`, `X-Forwarded-*`, and client IP headers. The gateway logs request ids, status codes, durations, client ids, and tool call completion.

In Nginx Proxy Manager, point the proxy host to the internal nginx service, then use `/project-memory/ready` for readiness checks where supported.
