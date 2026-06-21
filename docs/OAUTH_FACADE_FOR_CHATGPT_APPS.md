# OAUTH_FACADE_FOR_CHATGPT_APPS.md

## Goal

Implement a lightweight OAuth façade for the existing `project-memory` MCP server so it can be connected to ChatGPT Apps / custom MCP Apps.

The MCP server already exists. Do not rewrite the MCP core.

The goal is to add an OAuth-compatible layer around it:

- the user authenticates with a private magic token;
- ChatGPT receives an OAuth authorization code;
- ChatGPT exchanges the code for an access token using PKCE;
- ChatGPT calls the MCP server with `Authorization: Bearer <access_token>`;
- the MCP server validates that OAuth token before executing tools.

This façade exists because ChatGPT Apps expect OAuth for authenticated custom MCP servers, not a manually configured static Bearer token.

## Architecture

Use this structure:

```text
ChatGPT App
  |
  | 1. Discovers MCP protected resource metadata
  v
project-memory MCP server
  |
  | 2. Points ChatGPT to auth server
  v
OAuth façade / auth server
  |
  | 3. User enters magic token
  | 4. Auth server issues authorization code
  | 5. ChatGPT exchanges code + PKCE verifier for access token
  v
ChatGPT App
  |
  | 6. Calls MCP with Authorization: Bearer <access_token>
  v
project-memory MCP server
  |
  | 7. Validates token
  v
project-memory tools
```

The magic token must never be used as the MCP Bearer token directly.

The magic token is only a login / authorization credential used by the façade.

## Recommended deployment model

Prefer a same-origin deployment for v1:

```text
https://mcp.example.com/mcp
https://mcp.example.com/.well-known/oauth-protected-resource
https://mcp.example.com/.well-known/oauth-authorization-server
https://mcp.example.com/.well-known/jwks.json
https://mcp.example.com/oauth/authorize
https://mcp.example.com/oauth/token
```

This keeps discovery, redirects, cookies, CORS, and debugging much simpler.

A split-origin deployment is possible:

```text
MCP:  https://mcp.example.com
Auth: https://auth.example.com
```

But only use it if there is a real need.

## Required endpoints

Implement these endpoints.

---

## MCP protected resource metadata

```http
GET /.well-known/oauth-protected-resource
```

Return metadata describing the protected MCP resource.

Example:

```json
{
  "resource": "https://mcp.example.com",
  "authorization_servers": ["https://mcp.example.com"],
  "scopes_supported": ["memory:read", "memory:write"],
  "resource_documentation": "https://mcp.example.com/docs"
}
```

If the auth server is on a separate origin:

```json
{
  "resource": "https://mcp.example.com",
  "authorization_servers": ["https://auth.example.com"],
  "scopes_supported": ["memory:read", "memory:write"],
  "resource_documentation": "https://mcp.example.com/docs"
}
```

## OAuth authorization server metadata

```http
GET /.well-known/oauth-authorization-server
```

Return OAuth server metadata.

Minimal example:

```json
{
  "issuer": "https://mcp.example.com",
  "authorization_endpoint": "https://mcp.example.com/oauth/authorize",
  "token_endpoint": "https://mcp.example.com/oauth/token",
  "jwks_uri": "https://mcp.example.com/.well-known/jwks.json",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none"],
  "scopes_supported": ["memory:read", "memory:write"]
}
```

Use:

```json
"token_endpoint_auth_methods_supported": ["none"]
```

for a public-client PKCE flow. If `PROJECT_MEMORY_OAUTH_CLIENT_SECRET` is
configured, use:

```json
"token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"]
```

The gateway also supports predefined-client allowlisting with
`PROJECT_MEMORY_OAUTH_CLIENT_ID`. When that variable is set, `/oauth/authorize`
and `/oauth/token` reject other client ids.

## Authorization endpoint

```http
GET /oauth/authorize
```

Must accept standard OAuth parameters:

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

Behavior:

1. Validate required parameters.
2. Require `response_type=code`.
3. Require `code_challenge_method=S256`.
4. Preserve `state`.
5. Preserve `resource`.
6. Show a small HTML form asking for the magic token.
7. On success, issue a short-lived authorization code.
8. Redirect to:

```text
<redirect_uri>?code=<code>&state=<state>
```

Important:

- Do not log the magic token.
- Do not put the magic token in redirects.
- Do not store the magic token in the authorization code payload.
- Authorization codes must be one-time use.
- Authorization codes should expire quickly, for example in 5 minutes.
- Bind authorization code to:
  - `client_id`;
  - `redirect_uri`;
  - `code_challenge`;
  - `code_challenge_method`;
  - `resource`;
  - granted scopes.

## Token endpoint

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded
```

Must accept:

```text
grant_type=authorization_code
code=...
redirect_uri=...
client_id=...
client_secret=...    # optional, only for client_secret_post
code_verifier=...
resource=...
```

Alternatively, when `PROJECT_MEMORY_OAUTH_CLIENT_SECRET` is configured, accept
HTTP Basic client authentication:

```text
Authorization: Basic base64(client_id:client_secret)
```

Behavior:

1. Validate `grant_type=authorization_code`.
2. Validate client authentication before consuming the authorization code.
3. Load the authorization code.
4. Reject if the code is expired or already used.
5. Validate `client_id`.
6. Validate `redirect_uri`.
7. Validate `resource`.
8. Verify PKCE:

```text
base64url(sha256(code_verifier)) == code_challenge
```

9. Mark the authorization code as used.
10. Issue access token.

Return:

```json
{
  "access_token": "<jwt>",
  "token_type": "Bearer",
  "scope": "memory:read memory:write"
}
```

Refresh token is optional.

For v1, do not add refresh tokens unless they are actually needed.

The authorization code should be short-lived and one-time-use. The issued
access token is intentionally non-expiring for the internal trusted-token
deployment model, because ChatGPT may otherwise drop MCP authorization during a
long-lived chat.

## JWKS endpoint

```http
GET /.well-known/jwks.json
```

Return public keys for JWT verification.

Prefer asymmetric signing:

```text
EdDSA or RS256
```

Avoid HS256 if possible, because a symmetric secret makes clean separation between auth issuing and MCP verification worse.

Recommended JWT claims:

```text
iss: https://mcp.example.com
aud: https://mcp.example.com
sub: project-memory-user
scope: memory:read memory:write
iat: issued at
jti: unique token id
```

The MCP server must verify:

- token signature;
- issuer;
- audience / resource;
- required scopes.

## MCP auth behavior

For protected tools, the MCP server must require OAuth.

If the request has no valid Bearer token, return an auth challenge.

HTTP-level challenge:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="memory:read memory:write"
```

If the MCP SDK/server supports tool-level auth challenges, also return the appropriate `_meta["mcp/www_authenticate"]` challenge in tool responses.

The goal is that ChatGPT understands the MCP server is protected and opens the OAuth linking flow.

## Tool security schemes

Declare auth requirements per tool.

Example conceptual tool metadata:

```json
{
  "securitySchemes": [
    {
      "type": "oauth2",
      "scopes": ["memory:read"]
    }
  ]
}
```

Suggested scopes:

```text
memory:read   read/search/list project memory
memory:write  create/update/delete project memory entries
memory:admin  optional future admin operations
```

Keep scopes coarse for now.

Suggested mapping:

```text
search/read/list tools      -> memory:read
create/update/delete tools  -> memory:read memory:write
admin/maintenance tools     -> memory:admin
```

## Magic token behavior

The magic token is configured server-side.

Environment variable:

```bash
PROJECT_MEMORY_MAGIC_TOKEN="..."
```

Optional safer variant:

```bash
PROJECT_MEMORY_MAGIC_TOKEN_HASH="..."
```

Prefer storing a hash instead of a raw token if easy.

Rules:

- The magic token is only accepted at `/oauth/authorize`.
- Never accept the magic token as `Authorization: Bearer`.
- Never return the magic token to ChatGPT.
- Never store the magic token in memory records.
- Never log it.
- Rate-limit failed attempts.
- Add a generic error message: `Invalid token`.
- Consider adding a lockout/backoff after repeated failures.

## State storage

For the first implementation, use one of these options.

### Option A: In-memory storage

Acceptable for local/dev only.

Store authorization codes in memory:

```ts
type AuthorizationCodeRecord = {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  resource: string;
  scopes: string[];
  expiresAt: number;
  used: boolean;
};
```

Downside: authorization codes disappear on process restart.

### Option B: SQLite storage

Better for a durable single-node service.

Table:

```sql
CREATE TABLE oauth_authorization_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL,
  resource TEXT NOT NULL,
  scopes TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
```

Token revocation is optional for v1.

## Client registration

Start with the simplest practical path.

### v1 recommendation

Support public-client PKCE with:

```json
"token_endpoint_auth_methods_supported": ["none"]
```

Do not implement Dynamic Client Registration unless ChatGPT App setup requires it in this workspace.

If predefined OAuth client configuration is required in the ChatGPT App creation UI, use the client metadata from that UI and allowlist the redirect URI shown there.

The ChatGPT redirect URI will be shown in app management and usually looks like:

```text
https://chatgpt.com/connector/oauth/{callback_id}
```

Add it to the allowed redirect URI list if the implementation uses an allowlist.

### Optional v2

Add Dynamic Client Registration:

```http
POST /oauth/register
```

Only implement this if necessary.

For v1, avoid extra complexity.

## Configuration

Add env vars:

```bash
PROJECT_MEMORY_PUBLIC_URL="https://mcp.example.com"
PROJECT_MEMORY_OAUTH_ISSUER="https://mcp.example.com"
PROJECT_MEMORY_OAUTH_AUDIENCE="https://mcp.example.com"
PROJECT_MEMORY_MAGIC_TOKEN="change-me"
PROJECT_MEMORY_AUTH_CODE_TTL_SECONDS="300"
PROJECT_MEMORY_ALLOWED_REDIRECT_URIS="https://chatgpt.com/connector/oauth/...,https://claude.ai/api/mcp/auth_callback"
PROJECT_MEMORY_OAUTH_CLIENT_ID="chatgpt"
# Optional. Enables client_secret_post and client_secret_basic.
PROJECT_MEMORY_OAUTH_CLIENT_SECRET="change-me-too"
PROJECT_MEMORY_OAUTH_SCOPES="memory:read memory:write"
# Optional extra allowed OAuth resource identifiers. The gateway also accepts
# PROJECT_MEMORY_OAUTH_AUDIENCE and PROJECT_MEMORY_PUBLIC_URL + "/mcp".
PROJECT_MEMORY_OAUTH_RESOURCES="https://mcp.example.com/mcp"
```

If same-origin:

```text
PROJECT_MEMORY_PUBLIC_URL == PROJECT_MEMORY_OAUTH_ISSUER
```

## Implementation checklist

### Discovery

- [ ] Add `GET /.well-known/oauth-protected-resource`.
- [ ] Add `GET /.well-known/oauth-authorization-server`.
- [ ] Add `GET /.well-known/jwks.json`.

### OAuth flow

- [ ] Add `GET /oauth/authorize`.
- [ ] Add `POST /oauth/authorize` or handle form submission.
- [ ] Add `POST /oauth/token`.
- [ ] Implement authorization-code storage.
- [ ] Implement one-time-use authorization codes.
- [ ] Implement PKCE S256 verification.
- [ ] Issue signed JWT access tokens.

### MCP protection

- [ ] Parse `Authorization: Bearer <token>`.
- [ ] Verify JWT signature.
- [ ] Verify `iss`.
- [ ] Verify `aud` or `resource`.
- [ ] Verify `nbf` if present.
- [x] Verify scopes per tool.
- [x] Support MCP-specific resource identifiers such as `/api/mcp`.
- [x] Serve authorization metadata for RFC 8414 path-insertion discovery.
- [ ] Return `401` with `WWW-Authenticate` challenge when missing/invalid.
- [ ] Add tool `securitySchemes`.

### Security

- [ ] Do not log secrets.
- [ ] Rate-limit magic-token attempts.
- [ ] Use HTTPS only.
- [ ] Keep authorization codes short-lived and one-time-use.
- [ ] Do not set an access-token expiry unless ChatGPT reconnect behavior is verified.
- [ ] Use secure random values for codes and token IDs.
- [ ] Add tests for:
  - missing token;
  - invalid token;
  - wrong issuer;
  - wrong audience;
  - wrong scope;
  - reused authorization code;
  - invalid PKCE verifier.

## Minimal route examples

These examples are conceptual. Adapt them to the actual framework used by `project-memory`.

### Protected resource metadata

```ts
app.get("/.well-known/oauth-protected-resource", (req, res) => {
  const baseUrl = env.PROJECT_MEMORY_PUBLIC_URL;

  res.json({
    resource: baseUrl,
    authorization_servers: [env.PROJECT_MEMORY_OAUTH_ISSUER],
    scopes_supported: ["memory:read", "memory:write"],
    resource_documentation: `${baseUrl}/docs`
  });
});
```

### OAuth metadata

```ts
app.get("/.well-known/oauth-authorization-server", (req, res) => {
  const issuer = env.PROJECT_MEMORY_OAUTH_ISSUER;

  res.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: env.PROJECT_MEMORY_OAUTH_CLIENT_SECRET
      ? ["client_secret_post", "client_secret_basic"]
      : ["none"],
    scopes_supported: ["memory:read", "memory:write"]
  });
});
```

### PKCE verification

```ts
import crypto from "node:crypto";

function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function verifyPkceS256(codeVerifier: string, expectedChallenge: string): boolean {
  const actual = base64url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );

  if (actual.length !== expectedChallenge.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(actual),
    Buffer.from(expectedChallenge)
  );
}
```

### Magic token check

```ts
import crypto from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);

  if (ab.length !== bb.length) {
    return false;
  }

  return crypto.timingSafeEqual(ab, bb);
}

function verifyMagicToken(input: string): boolean {
  const expected = env.PROJECT_MEMORY_MAGIC_TOKEN;

  if (!input || !expected) {
    return false;
  }

  return safeEqual(input, expected);
}
```

## Suggested files

Codex should adapt this list to the current repository structure.

Possible files:

```text
src/oauth/metadata.ts
src/oauth/authorize.ts
src/oauth/token.ts
src/oauth/jwks.ts
src/oauth/pkce.ts
src/oauth/jwt.ts
src/oauth/storage.ts
src/oauth/magic-token.ts
src/mcp/auth-middleware.ts
```

Possible tests:

```text
tests/oauth.metadata.test.ts
tests/oauth.authorize.test.ts
tests/oauth.token.test.ts
tests/oauth.pkce.test.ts
tests/mcp.auth.test.ts
```

## Expected manual test flow

1. Start MCP server locally or on HTTPS dev URL.
2. Open:

```text
https://mcp.example.com/.well-known/oauth-protected-resource
```

3. Confirm JSON is valid.
4. Open:

```text
https://mcp.example.com/.well-known/oauth-authorization-server
```

5. Confirm JSON is valid.
6. Add MCP server URL in ChatGPT Apps.
7. Trigger a protected tool.
8. ChatGPT should open OAuth linking UI.
9. Enter magic token.
10. ChatGPT should receive code and exchange it for access token.
11. MCP calls should arrive with:

```http
Authorization: Bearer <jwt>
```

12. MCP should execute tools only after token validation.

## Definition of done

This task is done when:

- ChatGPT Apps can discover the OAuth configuration.
- ChatGPT can start the OAuth flow.
- User can authorize with magic token.
- ChatGPT can exchange code with PKCE for an access token.
- ChatGPT calls the existing `project-memory` MCP server with Bearer token.
- MCP server rejects missing/invalid/wrong-scope tokens.
- Existing MCP tools continue working after successful auth.
- No static internal Bearer token is exposed to ChatGPT.
- Magic token is never logged or returned to the client.
- Tests cover the main happy path and failure modes.
