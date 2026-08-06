# AUTH.md

# Auth schema and bootstrap

This is the per-user access model for PMemUI (see `docs/AUTH_LAYERING.md` for
the edge/proxy layering rule it complements, and PMem decisions
`D-MEMORY-007`, `D-MEMORY-008`, `D-MEMORY-011`). It covers the schema, the CLI
bootstrap command, and the HTTP `/auth/*` routes (invites, email
verification, session login/logout). TOTP 2FA (`totp_enabled`,
`totp_secret`, `totp_recovery_code_hashes` already exist as columns) and the
read/write/admin scope + project-membership layer are separate, later tasks.

## Tables (migration `006_auth_users_sessions_tokens.cjs`)

### `users`

| column | notes |
|---|---|
| `id` | `uuid`-as-text, app-generated. Not the `P-`/`T-`-style prefixed ids used for project records — users aren't project-scoped domain records. |
| `email` | unique, stored lowercased |
| `password_hash` | nullable — null until the user completes the claim flow. No hashing library is wired up yet; recommend Node's built-in `crypto.scrypt` (no new native dependency) unless the next task has a reason to prefer `argon2`. |
| `email_verified_at` | nullable timestamp |
| `totp_secret` / `totp_enabled` / `totp_recovery_code_hashes` | 2FA fields (`text[]` for recovery code hashes), unused until the 2FA task |
| `role` | `admin` \| `member`, no finer-grained roles by design (D-MEMORY-007) |
| `invited_by` | nullable self-FK, `SET NULL` on delete |
| `status` | `active` \| `disabled` |

### `sessions`

Stores only `token_hash` (sha256 hex of the opaque bearer/cookie secret), never
the raw secret — same principle as `tokens.token_hash` below. A DB read
(backup, replica, log) never yields a live, directly usable session. The login
task computes `sha256(rawSecret)` to look up a session, and hands the browser
`rawSecret` (as an httpOnly cookie value) once, at issuance.

### `tokens`

Single-purpose bearer tokens for invite / verify-email / password-reset
links. `user_id` is nullable because an invite token is minted before the
invitee's `users` row exists; `email` carries the target in that case.
`purpose` is a check-constrained enum: `invite`, `verify_email`,
`password_reset`.

## Bootstrap: `pm3m admin create`

```bash
pm3m admin create --email owner@example.com
```

Root of trust is shell access to the machine running `pm3m`, not the network
— see D-MEMORY-008. Behavior:

- Fails if any `role = 'admin'` user already exists, unless `--force` is
  passed (bootstrap is one-time by default).
- Fails if a user with that email already exists.
- Creates the user with `role=admin`, `status=active`, and
  `email_verified_at` set immediately — shell access to the host is treated
  as a stronger trust signal than clicking an email link, so bootstrap admins
  skip email verification.
- Mints a `password_reset` token (24h expiry, single-use — enforced by the
  next task's claim route, not by this command) and prints a one-time link:
  `/auth/claim?token=<raw token>`.
- If `PROJECT_MEMORY_PUBLIC_URL` is set in `.env`, the link is printed as a
  full URL; otherwise only the path is printed with a note to prepend the
  PMemUI base URL manually.

The existing shared `MCP_TOKEN` is untouched by this bootstrap. Migrating it
into a credential owned by the bootstrap admin is explicitly deferred to the
scopes/attribution task (see PMem `T-MEMORY-029`), not done here.

## HTTP routes (`src/gateway/auth.ts`, wired into `src/gateway/http-server.ts`)

All routes are unprefixed on the gateway (same convention as `/oauth/*`);
nginx maps the public `API_ENDPOINT` prefix in front of them, same as every
other gateway route.

| Route | Auth required | Notes |
|---|---|---|
| `POST /auth/invite` | admin session cookie | Body `{ email }`. Fails if a user with that email already exists. Returns `{ email, claimPath }` — no email is sent (see below); the frontend/admin relays the link. |
| `GET /auth/claim?token=` | none | Resolves an `invite` or `password_reset` token to `{ email, purpose }` without consuming it — for rendering the "set your password" form. |
| `POST /auth/claim` | none | Body `{ token, password }`. For an `invite` token: creates the `users` row (`role=member`, `status=active`, `email_verified_at=null`) and immediately issues a `verify_email` token. For a `password_reset` token: just updates `password_hash` on the existing user. Returns `{ email, emailVerified, verifyEmailPath? }`. Single-use — replaying the token returns 400. |
| `POST /auth/verify-email?token=` | none | Marks `email_verified_at`. Single-use. |
| `POST /auth/login` | none | Body `{ email, password }`. Rejects with the *same* generic "Invalid email or password" for both "no such user" and "wrong password" (and runs a same-cost dummy hash for the former so the two cases aren't distinguishable by timing) — see `verifyPassword`/`hashPassword` in `auth.ts`. Rejects with distinct messages for disabled accounts and unverified email (those checks only run after a correct password match, so they don't leak account existence). On success: sets an httpOnly, `SameSite=Lax` session cookie (`Secure` when `X-Forwarded-Proto: https` is present) and returns `{ status: "session", user }`. If `totp_enabled` is ever true (nothing sets it yet — that's the 2FA task), returns `{ status: "pending_totp", userId }` instead of a cookie. |
| `POST /auth/logout` | session cookie | Revokes the session (`revoked_at`) and clears the cookie. |

Passwords are hashed with Node's built-in `crypto.scrypt` (`scrypt$<saltHex>$<hashHex>`,
64-byte derived key, default N/r/p cost params) — no new dependency, matches
the recommendation left in the schema section. Session and one-shot tokens
are opaque `base64url(randomBytes(32))` strings; only their sha256 hash is
ever stored (`sessions.token_hash`, `tokens.token_hash`), so a database read
never yields a live, directly usable credential.

### GraphQL now accepts a session cookie

The GraphQL endpoint (and every other gateway route gated by `isAuthorized`)
now accepts three credential sources side by side: the static `MCP_TOKEN`
bearer, an OAuth bearer token, and a `pmem_session` cookie. A valid session
currently grants the same blanket access as a static token — the
read/write/admin scope split and project-membership visibility limits are
`T-MEMORY-029`, not implemented here. When a session is present, the
request's `clientId`/`clientLabel` (used for `gateway_clients` tracking and
event logging) become `user:<id>` / `<email>` instead of `anonymous:<requestId>`.

### No SMTP sending yet

`POST /auth/invite` and `POST /auth/claim` always return the link/token in
the JSON response body rather than emailing it — there is no SMTP client
wired up. This is a deliberate, honest "no SMTP configured" degradation
rather than a partial implementation: the admin (for invites) or the newly
claimed user's own browser (for verify-email, since the claim response
already came back to them) relays the link. Adding real SMTP delivery
(env vars, a mail library, templates) is future work, not silently assumed
to exist.

### Smoke coverage

`npm run smoke:gateway:auth` (`scripts/smoke-gateway-auth.ts`) runs the full
invite → claim → verify-email → login → GraphQL-over-session-cookie → logout
flow against the real gateway (ephemeral local instance, real Postgres),
including the negative cases: wrong password, invite without an admin
session, login before claim, login before verification, replaying a claim
token, and GraphQL access after logout.
