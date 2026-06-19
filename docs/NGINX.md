# Project Memory Gateway — Nginx

Use this only for the internal nginx that sits in front of the local PostgreSQL gateway. External TLS, host routing, and certificates can stay in Nginx Proxy Manager.

The gateway process should usually stay bound to localhost:

```text
BIND=127.0.0.1
PORT=8765
API_ENDPOINT=/project-memory
```

The Node gateway itself exposes unprefixed internal routes such as `/mcp`, `/health`, and `/ready`; nginx maps the public `API_ENDPOINT` prefix to those routes.

Use the ready-made internal server template:

```text
deploy/nginx/project-memory-gateway.server.conf
```

It listens on:

```text
127.0.0.1:8088
```

If you prefer to embed only the locations in an existing internal nginx `server {}` block, include:

```nginx
server {
  listen 127.0.0.1:8088;
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

Client launchers should use `GW_ENDPOINT` for the public gateway base URL:

```text
GW_ENDPOINT=https://memory.example.internal/project-memory
```

Clients append concrete routes such as `${GW_ENDPOINT}/mcp`, `${GW_ENDPOINT}/health`, and `${GW_ENDPOINT}/ready`.

If bearer auth is enabled on the gateway, the gateway runtime and clients must agree on the same token:

```text
MCP_TOKEN=...
MCP_CLIENT_AUTH=...
```

The nginx include forwards `X-Request-ID`, `X-Forwarded-*`, and client IP headers. The gateway logs request ids, status codes, durations, client ids, and tool call completion.

In Nginx Proxy Manager, point the proxy host to the internal nginx service:

```text
Forward Hostname / IP: <internal-nginx-host>
Forward Port: 8088
Scheme: http
```

Use `/project-memory/ready` for readiness checks where supported.
