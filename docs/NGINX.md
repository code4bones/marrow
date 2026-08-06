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
GET  /project-memory/artifacts/<id>/download
GET  /project-memory/.well-known/oauth-protected-resource
GET  /project-memory/.well-known/oauth-protected-resource/mcp
GET  /project-memory/.well-known/oauth-authorization-server
GET  /.well-known/oauth-authorization-server/project-memory
GET  /.well-known/openid-configuration/project-memory
GET  /.well-known/oauth-protected-resource/project-memory/mcp
GET  /project-memory/.well-known/jwks.json
GET  /project-memory/oauth/authorize
POST /project-memory/oauth/authorize
POST /project-memory/oauth/token
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

Clients append concrete routes such as `${GW_ENDPOINT}/mcp`, `${GW_ENDPOINT}/health`, `${GW_ENDPOINT}/ready`, and `${GW_ENDPOINT}/artifacts/<id>/download`.

If bearer auth is enabled on the gateway, the gateway runtime and clients must agree on the same token:

```text
MCP_TOKEN=...
MCP_CLIENT_AUTH=...
```

For ChatGPT Apps/custom MCP Apps, enable the OAuth facade on the gateway:

```text
PROJECT_MEMORY_PUBLIC_URL=https://memory.example.internal/project-memory
PROJECT_MEMORY_OAUTH_ISSUER=https://memory.example.internal/project-memory
PROJECT_MEMORY_OAUTH_AUDIENCE=https://memory.example.internal/project-memory
PROJECT_MEMORY_MAGIC_TOKEN=...
PROJECT_MEMORY_ALLOWED_REDIRECT_URIS=https://chatgpt.com/connector/oauth/...,https://claude.ai/api/mcp/auth_callback
PROJECT_MEMORY_OAUTH_CLIENT_ID=chatgpt
# Optional confidential-client secret; omit to use public PKCE client auth.
PROJECT_MEMORY_OAUTH_CLIENT_SECRET=...
# Optional stable signing key; if omitted, tokens are invalidated on restart.
PROJECT_MEMORY_OAUTH_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n..."
```

Generate the signing key value with:

```bash
pm3m oauth key
```

The OAuth discovery and token routes are public by design. The nginx include
maps the prefixed public routes to the gateway's internal unprefixed OAuth
routes.

Claude Custom Connectors follow RFC 8414 path-insertion discovery for issuers
with path components. If `PROJECT_MEMORY_OAUTH_ISSUER` is
`https://memory.example.internal/project-memory`, Claude may request
`/.well-known/oauth-authorization-server/project-memory` and
`/.well-known/openid-configuration/project-memory` at the domain root. The nginx
include proxies those root well-known routes to the gateway as well. For your
own `API_ENDPOINT`, replace `project-memory` in the examples with that public
prefix, for example `/api`.

When `PROJECT_MEMORY_OAUTH_CLIENT_SECRET` is set, the authorization server
metadata advertises `client_secret_post` and `client_secret_basic`. Without it,
metadata advertises `none` for public PKCE clients.

The nginx include forwards `X-Request-ID`, `X-Forwarded-*`, and client IP headers. The gateway logs request ids, status codes, durations, client ids, and tool call completion.

In Nginx Proxy Manager, point the proxy host to the internal nginx service:

```text
Forward Hostname / IP: <internal-nginx-host>
Forward Port: 8088
Scheme: http
```

Use `/project-memory/ready` for readiness checks where supported.

If you add an Nginx Proxy Manager Access List (Basic Auth) or any other
`Authorization`-based edge check in front of a host that also serves a
gateway-backed frontend, see [docs/AUTH_LAYERING.md](AUTH_LAYERING.md) first —
scope it to exclude the API path prefix, or it will collide with the app's
own `Authorization: Bearer` header.
