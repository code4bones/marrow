# Chat Connector OAuth Guide

This document describes the reusable pattern we used to expose this MCP gateway
as a custom connector / app in ChatGPT and Claude web chat surfaces.

Use it as a portability guide for another MCP server. Product-specific names in
examples use `project-memory` / `pmem`, but the architecture is not PMem-specific.

## Goal

Many local or internal MCP servers already support a private bearer token for
trusted clients. ChatGPT and Claude web connector flows cannot rely on a manually
configured static bearer token in the same way. They expect OAuth discovery,
authorization, token exchange, and authenticated MCP requests.

The pragmatic solution is an OAuth facade around the existing MCP server:

```text
Chat host
  -> discovers protected MCP resource metadata
  -> opens OAuth authorize URL
  -> user enters private magic token
  -> facade issues an authorization code
  -> host exchanges code + PKCE verifier for JWT access token
  -> host calls /mcp with Authorization: Bearer <oauth_access_token>
  -> gateway validates OAuth JWT and executes MCP tools
```

The facade does not replace internal bearer-token auth. It coexists with it.
Internal agents can still use `MCP_TOKEN`; ChatGPT/Claude use OAuth access
tokens issued by the facade.

## Public Surface

Prefer same-origin deployment. If the public gateway base URL is:

```text
https://mcp.example.com/api
```

Expose these public routes:

```text
POST /api/mcp
GET  /api/.well-known/oauth-protected-resource
GET  /api/.well-known/oauth-protected-resource/mcp
GET  /api/.well-known/oauth-authorization-server
GET  /api/.well-known/jwks.json
GET  /api/oauth/authorize
POST /api/oauth/authorize
POST /api/oauth/token
```

Also expose root well-known path-insertion routes for hosts that follow RFC 8414
with issuer paths:

```text
GET /.well-known/oauth-authorization-server/api
GET /.well-known/openid-configuration/api
GET /.well-known/oauth-protected-resource/api/mcp
```

Claude Custom Connectors needed these root well-known routes in our deployment.
Without them, Claude may fall back to a wrong path such as `/authorization` or
fail discovery even though `/api/.well-known/...` works.

## Runtime Configuration

Use separate variables for internal gateway auth and OAuth facade auth:

```bash
# Existing internal auth for CLI/agents/services.
MCP_TOKEN="internal-static-gateway-token"

# Public URL used by ChatGPT/Claude. Include the public path prefix.
PROJECT_MEMORY_PUBLIC_URL="https://mcp.example.com/api"

# Usually same as public URL for same-origin deployment.
PROJECT_MEMORY_OAUTH_ISSUER="https://mcp.example.com/api"
PROJECT_MEMORY_OAUTH_AUDIENCE="https://mcp.example.com/api"

# Private user-facing login token for the OAuth authorize form.
PROJECT_MEMORY_MAGIC_TOKEN="private-human-login-token"

# Safer alternative to raw magic token.
# PROJECT_MEMORY_MAGIC_TOKEN_HASH="sha256:<hex>"

# Optional allowlist. Set this when the chat host lets you configure client_id.
PROJECT_MEMORY_OAUTH_CLIENT_ID="pmem"

# Optional confidential client support.
# If set, metadata advertises client_secret_post and client_secret_basic.
PROJECT_MEMORY_OAUTH_CLIENT_SECRET="optional-client-secret"

# Optional redirect allowlist. Use exact redirects when known.
PROJECT_MEMORY_ALLOWED_REDIRECT_URIS="https://chatgpt.com/connector/oauth/...,https://claude.ai/api/mcp/auth_callback"

# Recommended stable signing key. Without it, generated tokens break on restart.
PROJECT_MEMORY_OAUTH_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# Optional.
PROJECT_MEMORY_AUTH_CODE_TTL_SECONDS=300
PROJECT_MEMORY_OAUTH_SCOPES="memory:read memory:write"
PROJECT_MEMORY_OAUTH_KEY_ID="pmem-oauth"
```

For this package, generate a dotenv-ready RSA private key with:

```bash
pm3m oauth key
```

For another MCP project, implement an equivalent helper or use OpenSSL/Node to
generate an RSA private key. Store the private key server-side only.

## OAuth Facade Behavior

### Protected Resource Metadata

`GET /.well-known/oauth-protected-resource`

Return:

```json
{
  "resource": "https://mcp.example.com/api",
  "authorization_servers": ["https://mcp.example.com/api"],
  "scopes_supported": ["memory:read", "memory:write"],
  "resource_documentation": "https://mcp.example.com/api/docs"
}
```

When the request is for a sub-resource such as `/mcp`, return that resource if
it is in the allowed resource list:

```json
{
  "resource": "https://mcp.example.com/api/mcp",
  "authorization_servers": ["https://mcp.example.com/api"],
  "scopes_supported": ["memory:read", "memory:write"]
}
```

### Authorization Server Metadata

`GET /.well-known/oauth-authorization-server`

Return:

```json
{
  "issuer": "https://mcp.example.com/api",
  "authorization_endpoint": "https://mcp.example.com/api/oauth/authorize",
  "token_endpoint": "https://mcp.example.com/api/oauth/token",
  "jwks_uri": "https://mcp.example.com/api/.well-known/jwks.json",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["memory:read", "memory:write"]
}
```

If `PROJECT_MEMORY_OAUTH_CLIENT_SECRET` is configured, advertise:

```json
{
  "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"]
}
```

### Authorization Endpoint

`GET /oauth/authorize`

Accept:

```text
response_type=code
client_id=...
redirect_uri=...
scope=...
state=...
code_challenge=...
code_challenge_method=S256
resource=...
```

Validate:

- `response_type=code`
- required OAuth params
- `code_challenge_method=S256`
- optional configured `client_id`
- optional redirect allowlist
- allowed `resource`

Render a small HTML form that asks for the private magic token. The magic token
is a human login credential for the facade. It is not the MCP bearer token.

`POST /oauth/authorize`

On valid magic token:

1. create a cryptographically random authorization code;
2. bind it to `client_id`, `redirect_uri`, `resource`, scopes, and PKCE
   challenge;
3. store it as short-lived and one-time-use;
4. redirect back to `<redirect_uri>?code=<code>&state=<state>`.

### Token Endpoint

`POST /oauth/token`

Accept form-urlencoded:

```text
grant_type=authorization_code
code=...
redirect_uri=...
client_id=...
client_secret=... # optional, if confidential client
code_verifier=...
resource=...
```

Validate before issuing a token:

- client authentication when a secret is configured;
- code exists, is unused, and has not expired;
- `client_id` matches the code;
- `redirect_uri` matches the code;
- `resource` matches the code;
- `base64url(sha256(code_verifier))` equals the stored challenge.

Return:

```json
{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "scope": "memory:read memory:write"
}
```

For our internal deployment model, access tokens intentionally do not include
`exp`. Chat hosts can keep long-running chats connected without the MCP
authorization silently expiring. Authorization codes are still short-lived and
one-time-use.

### JWKS

`GET /.well-known/jwks.json`

Return the public key for JWT verification. This implementation uses RS256 with
a stable `kid`.

JWT claims:

```text
iss: configured issuer
aud: requested/allowed resource
sub: stable internal subject
client_id: OAuth client id
scope: granted scopes
iat: issued at
jti: unique token id
```

The MCP gateway must verify signature, issuer, audience/resource, and required
scopes before executing protected operations.

## MCP Authorization

Accept both auth modes:

1. internal static bearer:

```http
Authorization: Bearer <MCP_TOKEN>
```

2. OAuth bearer:

```http
Authorization: Bearer <oauth_access_token>
```

When a protected route has no valid auth, return `401` with an OAuth challenge:

```http
WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/api/.well-known/oauth-protected-resource/mcp", scope="memory:read memory:write"
```

This challenge is important. It tells chat hosts where to discover OAuth
metadata and how to start linking.

Use coarse scopes at first:

```text
read/list/search tools      -> memory:read
create/update/delete tools  -> memory:read memory:write
admin tools                 -> memory:admin, optional later
```

In PMem we grant the full configured internal scope set after successful OAuth,
even if the host initially asks only for `memory:read`. Some hosts do not retry
OAuth scope escalation before calling write tools.

## ChatGPT Connector Notes

Use the public MCP URL:

```text
https://mcp.example.com/api/mcp
```

ChatGPT discovers OAuth through the protected-resource metadata and follows the
authorization-code + PKCE flow.

Implementation notes:

- The OAuth redirect URI is host-generated. Add it to
  `PROJECT_MEMORY_ALLOWED_REDIRECT_URIS` when you use strict allowlisting.
- If ChatGPT lets you configure `client_id` / `client_secret`, set matching
  `PROJECT_MEMORY_OAUTH_CLIENT_ID` and optional
  `PROJECT_MEMORY_OAUTH_CLIENT_SECRET`.
- Do not expose the internal `MCP_TOKEN` to ChatGPT.
- Keep `PROJECT_MEMORY_MAGIC_TOKEN` server-side and enter it only in the OAuth
  authorization form.
- Make sure the MCP endpoint supports Streamable HTTP and returns tool
  `outputSchema`; ChatGPT surfaces warnings when schemas are missing.

## Claude Custom Connector Notes

Use the same public MCP URL:

```text
https://mcp.example.com/api/mcp
```

Claude-specific lessons from this implementation:

- Claude may request root path-insertion discovery:
  `/.well-known/oauth-authorization-server/api` and
  `/.well-known/openid-configuration/api`.
- If those routes are missing, Claude may appear to ignore your configured
  metadata and try a wrong path.
- Claude's frontend rejected dotted tool names in our test with a pattern like
  `^[a-zA-Z0-9_-]{1,64}$`.
- Provide transport aliases for Claude-safe names. PMem converts canonical
  names like `project.create` to `project_create` when `client_kind` or
  `User-Agent` indicates Claude.
- Tool execution maps aliases back to canonical tool names server-side.

Recommended MCP URL for Claude:

```text
https://mcp.example.com/api/mcp?client_id=<stable-client-id>&client_label=<human-label>&client_kind=claude-code
```

The `client_kind=claude-code` query parameter is not OAuth. It is a server-side
hint for PMem to expose Claude-safe tool names.

## Nginx / Reverse Proxy Pattern

If the internal MCP server listens on unprefixed routes:

```text
/mcp
/.well-known/oauth-protected-resource
/.well-known/oauth-authorization-server
/.well-known/jwks.json
/oauth/authorize
/oauth/token
```

and the public prefix is `/api`, the reverse proxy must map prefixed public
paths to unprefixed internal paths:

```nginx
location = /api/mcp {
  proxy_pass http://mcp_back/mcp;
  proxy_http_version 1.1;
  proxy_buffering off;
  proxy_read_timeout 120s;
  proxy_send_timeout 120s;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Request-ID $request_id;
  proxy_set_header Authorization $http_authorization;
}

location = /api/.well-known/oauth-protected-resource {
  proxy_pass http://mcp_back/.well-known/oauth-protected-resource;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}

location ^~ /api/.well-known/oauth-protected-resource/ {
  proxy_pass http://mcp_back/.well-known/oauth-protected-resource/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}

location = /api/.well-known/oauth-authorization-server {
  proxy_pass http://mcp_back/.well-known/oauth-authorization-server;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}

location ~ ^/\.well-known/(oauth-authorization-server|openid-configuration|oauth-protected-resource)/api(/.*)?$ {
  proxy_pass http://mcp_back;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}

location = /api/.well-known/jwks.json {
  proxy_pass http://mcp_back/.well-known/jwks.json;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}

location = /api/oauth/authorize {
  client_max_body_size 64k;
  proxy_pass http://mcp_back/oauth/authorize;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}

location = /api/oauth/token {
  limit_except POST { deny all; }
  client_max_body_size 64k;
  proxy_pass http://mcp_back/oauth/token;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Add your normal health, tools, artifact, GraphQL, or app-specific routes
separately.

## Verification Checklist

Use these checks before trying the chat UI.

### Readiness

```bash
curl -i https://mcp.example.com/api/ready
```

### Protected resource metadata

```bash
curl -fsS https://mcp.example.com/api/.well-known/oauth-protected-resource | jq .
curl -fsS https://mcp.example.com/api/.well-known/oauth-protected-resource/mcp | jq .
```

Check:

- `authorization_servers` contains the issuer.
- `resource` is the public resource URL.
- scopes are present.

### Authorization server metadata

```bash
curl -fsS https://mcp.example.com/api/.well-known/oauth-authorization-server | jq .
curl -fsS https://mcp.example.com/.well-known/oauth-authorization-server/api | jq .
curl -fsS https://mcp.example.com/.well-known/openid-configuration/api | jq .
```

Check:

- `issuer` matches configured issuer exactly.
- endpoints are public URLs, not internal upstream URLs.
- `jwks_uri` is public and reachable.
- token auth methods match your client-secret configuration.

### JWKS

```bash
curl -fsS https://mcp.example.com/api/.well-known/jwks.json | jq .
```

Check:

- at least one public key exists;
- `kid` matches the JWT header from issued tokens.

### Auth challenge

```bash
curl -i https://mcp.example.com/api/mcp
```

For unauthenticated requests, check `WWW-Authenticate` includes
`resource_metadata=...oauth-protected-resource...`.

### OAuth smoke flow

For automated tests, reproduce this sequence:

1. `GET /oauth/authorize` with PKCE params returns an HTML form.
2. bad magic token returns generic invalid token response.
3. valid magic token returns `302` with `code` and original `state`.
4. `POST /oauth/token` exchanges code + verifier for access token.
5. same code cannot be reused.
6. bearer access token can call `/mcp` / `/call` / protected tools.
7. read-request token can still execute internal write flow if your product
   intentionally grants full internal scopes.

This repository's reference test is `scripts/smoke-oauth.ts`.

## Security Rules

- Never expose `MCP_TOKEN` to ChatGPT or Claude.
- Never accept the magic token as a bearer token.
- Never log magic tokens, client secrets, authorization codes, code verifiers,
  JWTs, or raw authorization headers.
- Redact OAuth form fields in request logs.
- Authorization codes must be short-lived and one-time-use.
- Prefer a stable asymmetric signing key.
- Keep redirect URI allowlisting strict when host redirects are stable.
- Add rate limiting/backoff for failed magic-token attempts.
- Keep scopes coarse until there is a real multi-tenant permission model.

## Porting Checklist For Another MCP Server

1. Keep your existing MCP transport unchanged.
2. Add an OAuth facade module:
   - metadata endpoints;
   - authorize form;
   - one-time authorization code store;
   - token endpoint;
   - JWKS endpoint;
   - JWT verification.
3. Add auth middleware that accepts either internal bearer or OAuth bearer.
4. Map routes through nginx / proxy, including root path-insertion well-known
   routes for path-prefixed issuers.
5. Return `WWW-Authenticate` challenges for unauthenticated MCP requests.
6. Add OAuth scopes to tool authorization decisions.
7. Add output schemas for tools.
8. Add Claude-safe aliases if your canonical tool names contain dots or other
   characters outside `[a-zA-Z0-9_-]`.
9. Write smoke tests for:
   - metadata;
   - auth challenge;
   - PKCE exchange;
   - client secret modes;
   - one-time code use;
   - OAuth bearer tool call;
   - Claude-safe tool listing.
10. Connect ChatGPT first, then Claude. Claude is stricter about discovery paths
    and tool-name format.

## Common Failure Modes

### Chat host opens a wrong authorization URL

Usually discovery is incomplete or proxied at the wrong path. Verify both
prefixed metadata and root path-insertion metadata.

### Token exchange fails with invalid target/resource

The `resource` from `/oauth/authorize` must match what `/oauth/token` receives
and what your JWT verifier accepts as audience.

### Connector works for reads but writes fail

The host may have requested only read scope. For trusted internal products, grant
the full configured scope set after successful OAuth, or implement explicit
scope escalation.

### Claude rejects tools

Check tool names. Claude web UI rejected dotted names in our deployment. Expose
aliases such as `artifact_read_text` and map them back to canonical names.

### Auth breaks after gateway restart

Use a stable `PROJECT_MEMORY_OAUTH_PRIVATE_KEY_PEM`. Generated ephemeral keys
invalidate previously issued JWTs.

### OAuth form works but callback is rejected

Check redirect URI allowlist. Some hosts generate exact redirect URLs with
connector-specific suffixes. Add the exact URI or temporarily disable strict
allowlisting only for controlled internal testing.
