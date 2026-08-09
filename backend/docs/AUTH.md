# AUTH.md

# Auth schema and bootstrap

This is the per-user access model for Marrow's web UI (see `docs/AUTH_LAYERING.md` for
the edge/proxy layering rule it complements, and Marrow decisions
`D-MEMORY-007`, `D-MEMORY-008`, `D-MEMORY-011`, `D-MEMORY-016`, `D-MEMORY-019`).
It covers the schema, the CLI bootstrap command, the HTTP `/auth/*` routes
(the original invite→claim→verify-email path, session login/logout, TOTP 2FA
(bind/unbind, shared by every role), open self-registration with inline TOTP
+ admin approval, and step-up admin elevation), and the read/write/admin
scope + project-membership layer (`T-MEMORY-029`, implementing
`D-MEMORY-007` and superseding `D-MEMORY-003`'s "trusted internal
deployment, one shared token" model) below.

## Tables (migration `006_auth_users_sessions_tokens.cjs`, plus `010_scopes_membership_attribution.cjs` for `project_members` and the `gateway_clients.owner_user_id`/`scope` columns, `011_admin_elevations.cjs` for `admin_elevations`, `012_git_credentials.cjs` for `git_credentials`, and `013_personal_tokens.cjs` for `personal_tokens` -- see "Scopes: read / write / admin", "Project membership", "Step-up admin elevation", "Git host credentials", and "Personal API tokens" below)

### `users`

| column | notes |
|---|---|
| `id` | `uuid`-as-text, app-generated. Not the `P-`/`T-`-style prefixed ids used for project records — users aren't project-scoped domain records. |
| `email` | unique, stored lowercased |
| `password_hash` | nullable — null until the user completes the claim flow. No hashing library is wired up yet; recommend Node's built-in `crypto.scrypt` (no new native dependency) unless the next task has a reason to prefer `argon2`. |
| `email_verified_at` | nullable timestamp |
| `totp_secret` / `totp_enabled` / `totp_recovery_code_hashes` | 2FA fields (`text[]` for recovery code hashes) — see "TOTP 2FA" below |
| `role` | `admin` \| `member`, no finer-grained roles by design (D-MEMORY-007) |
| `invited_by` | nullable self-FK, `SET NULL` on delete |
| `status` | `active` \| `disabled` \| `pending_approval` (migration `009_totp_registration.cjs`; see "Open self-registration" below) |

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

### `pending_registrations` (migration `009_totp_registration.cjs`)

Holds an open self-registration (D-MEMORY-016) between `POST /auth/register`
and a successful `POST /auth/register/confirm` — the real `users` row is
only created once the applicant proves they control the TOTP secret, the
same "don't create the row until the flow really completes" principle the
`tokens`-gated invite path already uses.

| column | notes |
|---|---|
| `id` | text pk, app-generated |
| `email` | unique, stored lowercased. A second `/auth/register` for the same email while a row is still valid here is rejected with the same "already exists" message as an occupied `users.email`; an *expired* row for that email is swept lazily the next time someone registers with it (no cron). |
| `password_hash` | `scrypt$...`, same format as `users.password_hash` — hashed at register time, copied into the `users` row verbatim on confirm |
| `totp_secret_enc` | the encrypted TOTP secret (see "TOTP 2FA" below) generated at register time; copied verbatim into `users.totp_secret` on confirm, so the same secret the applicant scanned into their authenticator app is the one that ends up live |
| `token_hash` | unique, sha256 hex of the opaque `token` returned by `/auth/register` — same pattern as `tokens.token_hash` |
| `created_at` / `expires_at` | 30-minute TTL from creation |

Indexed on `email` and `expires_at` (`idx_pending_registrations_email`,
`idx_pending_registrations_expires_at`).

### `admin_elevations` (migration `011_admin_elevations.cjs`)

Short-lived, single-use step-up grants (`D-MEMORY-019`) minted by `POST
/auth/elevate` and redeemed via the `X-Project-Memory-Elevation` header on
an admin-tier gateway call — see "Step-up admin elevation" below.

| column | notes |
|---|---|
| `id` | text pk, app-generated (`randomUUID()`, same as `sessions.id`/`tokens.id`) |
| `user_id` | the admin whose password+TOTP minted this grant; `ON DELETE CASCADE` |
| `token_hash` | unique, sha256 hex of the opaque grant token — same pattern as `sessions.token_hash`/`tokens.token_hash`, never the raw secret |
| `created_at` / `expires_at` | 60-second TTL from creation (`ELEVATION_TTL_MS` in `auth.ts`) |
| `used_at` | nullable; set atomically by the one `UPDATE ... RETURNING` in `consumeElevation` — this is the single-use enforcement, not a separate check-then-write |
| `user_agent` / `ip` | best-effort audit fields from the `/auth/elevate` request, same as `sessions` |

Indexed on `user_id` and `expires_at` (`idx_admin_elevations_user_id`,
`idx_admin_elevations_expires_at`).

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
  Marrow web UI base URL manually.

The existing shared `MCP_TOKEN` is untouched by this bootstrap itself. It is
migrated into an owned, scoped credential separately at gateway startup --
see "MCP_TOKEN migration" below.

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
| `POST /auth/login` | none | Body `{ email, password }`. Rejects with the *same* generic "Invalid email or password" for both "no such user" and "wrong password" (and runs a same-cost dummy hash for the former so the two cases aren't distinguishable by timing) — see `verifyPassword`/`hashPassword` in `auth.ts`. Status checks run in this order after a correct password match: `pending_approval` gets its own message ("Your account is waiting for admin approval."), any other non-`active` status gets "This account has been disabled.", then (invite-path accounts only — see "Open self-registration" below) unverified email is rejected. On success: sets an httpOnly, `SameSite=Lax` session cookie (`Secure` when `X-Forwarded-Proto: https` is present) and returns `{ status: "session", user }`. If `totp_enabled` is true, returns `{ status: "pending_totp", userId }` instead of a cookie — the frontend then calls `POST /auth/login/2fa`. |
| `POST /auth/login/2fa` | none | Body `{ userId, code }` — second step after `/auth/login` returns `pending_totp`. `code` is either a 6-digit TOTP code or one unused recovery code (recovery codes are single-use: a match deletes that hash from `totp_recovery_code_hashes`). On success, identical response/cookie shape to `/auth/login`'s session case. Rate-limited the same way as `/auth/login` (see below), keyed by `userId` instead of email. |
| `POST /auth/logout` | session cookie | Revokes the session (`revoked_at`) and clears the cookie. |
| `GET /auth/me` | session cookie | `{ id, email, role, status, totpEnabled }` for the current session's user. |
| `GET /auth/bootstrap` | none | `{ adminExists }` — whether any `role=admin` user exists. Frontend uses this to decide whether to show the first-run self-register screen or the normal login form. |
| `POST /auth/bootstrap` | none, but only while `adminExists=false` | Body `{ email, password }`. First-visitor-becomes-admin: only works while the `users` table has zero `role=admin` rows; permanently 400s once one exists (checked and inserted inside one DB transaction to close the create-two-admins race). Creates the admin, marks email verified immediately, and logs them in — same response shape as `/auth/login`'s session case. See D-MEMORY-013 (supersedes D-MEMORY-008's rejection of this pattern) for why this is safe: the expected self-host flow is deploy locally/behind a firewall, bootstrap, *then* expose publicly, so the race D-MEMORY-008 worried about doesn't apply to the operator's own first visit. `pm3m admin create`/`admin set-password` still exist for headless/scripted bootstrap or when you want the stricter shell-access-rooted guarantee. Stays password-only by decision — no TOTP at bootstrap time, but the resulting admin can enroll via `/auth/2fa/enroll` afterwards like any other logged-in user. |
| `POST /auth/2fa/enroll` | session cookie | Only for an account with `totp_enabled=false` (409-equivalent `VALIDATION_ERROR` otherwise, telling the caller to disable first). Generates a TOTP secret, stores it encrypted in `users.totp_secret`, leaves `totp_enabled=false`. Returns `{ otpauthUrl, secretBase32 }` for rendering a QR code / manual-entry fallback. |
| `POST /auth/2fa/confirm` | session cookie | Body `{ code }`. Verifies `code` against the secret stored by `/auth/2fa/enroll`. On success: sets `totp_enabled=true`, generates 10 recovery codes, stores only their hashes, and returns `{ recoveryCodes }` — the only time the plaintext codes are ever sent. |
| `POST /auth/2fa/disable` | session cookie | Body `{ currentPassword }`. Verifies the password, then clears `totp_secret`/`totp_enabled`/`totp_recovery_code_hashes`. |
| `POST /auth/2fa/recovery-codes/regenerate` | session cookie | Body `{ currentPassword }`. Verifies the password, requires `totp_enabled=true`, replaces the stored recovery-code hashes with 10 fresh ones, and returns `{ recoveryCodes }` (plaintext, once). |
| `POST /auth/profile/password` | session cookie | Body `{ currentPassword, newPassword }`. Verifies the current password, then sets a new one (same ≥8-character rule as claim/register). |
| `GET /auth/profile/personal-token` | session cookie | `T-MEMORY-047`, see "Personal API tokens" below. `{ exists, tokenHint, createdAt, lastUsedAt }` -- side-effect-free, never the raw token. |
| `POST /auth/profile/personal-token/regenerate` | session cookie | `T-MEMORY-047`. Always issues a fresh token, invalidating any existing one for this user. Returns `{ token, tokenHint, createdAt }` -- the raw token, shown exactly once. |
| `POST /auth/elevate` | none (public, like `/auth/login`) | Body `{ email, password, code }`. Step-up admin elevation (`T-MEMORY-041`, `D-MEMORY-019`) — see "Step-up admin elevation" below. Re-checks the account's password *and* current TOTP code together (full re-authentication, not a session lookup); on success returns `{ token, expiresAt }`, a short-lived (60s), single-use grant. Rejects with the same generic `"Invalid email or password."` for a wrong password, `"Invalid verification code."` for a wrong TOTP code, `"Elevation is only available to admin accounts."` for a correctly-authenticated `role=member` account, and a `VALIDATION_ERROR` telling the caller to enable 2FA first if the (admin) account has no TOTP enrolled. Rate-limited the same way as `/auth/login` (email + IP keys, same in-memory limiter), with its own key prefix so it doesn't share counters with plain login attempts against the same account. |
| `POST /auth/register` | none | Body `{ email, password }`. Public, no invite required (D-MEMORY-016). Rejects if the email is already a `users` row or has a still-valid `pending_registrations` row (same "already exists" message as `/auth/invite`); a *password* under 8 characters is rejected the same as `/auth/claim`. Generates + encrypts a TOTP secret, stores a `pending_registrations` row (30-minute TTL) with an opaque token, and returns `{ token, otpauthUrl, secretBase32 }` for the QR/enroll screen. No `users` row exists yet. |
| `POST /auth/register/confirm` | none | Body `{ token, code }`. Looks up the `pending_registrations` row by `token_hash`; 400 "invalid or expired" if missing/expired, same message family as the invite/claim tokens. Verifies `code` against the stored secret; on success creates the real `users` row (`role=member`, `status=pending_approval`, `totp_enabled=true`, `email_verified_at=null`), deletes the `pending_registrations` row, and returns `{ email, recoveryCodes }` (plaintext codes, once). The account cannot log in yet — see `status=pending_approval` below. |
| `GET /auth/admin/pending-users` | admin session cookie | `[{ id, email, createdAt }]` for every `users` row with `status='pending_approval'`, oldest first. |
| `POST /auth/admin/pending-users/:id/approve` | admin session cookie | Sets `status=active`. The account can now log in — since `totp_enabled=true`, its next `/auth/login` returns `pending_totp` and needs `/auth/login/2fa` to finish. |
| `POST /auth/admin/pending-users/:id/reject` | admin session cookie | Sets `status=disabled`. Subsequent `/auth/login` attempts get the generic disabled message. |

`POST /auth/login` and `POST /auth/login/2fa` are rate-limited in-memory
(not Redis — this gateway runs as a single instance, no state to share
across replicas): 8 attempts per 15-minute window per key, either key
tripping blocks the attempt with `429` + `Retry-After`. `/auth/login` is
keyed independently by normalized email and by client IP; `/auth/login/2fa`
is keyed by `userId` and by client IP (the IP key is the same counter both
routes share, since there's no email in a `/auth/login/2fa` body). Both keys
used in a request are cleared on a successful call to either route. Resets
on process restart — acceptable at this scale, revisit if the
gateway ever runs more than one replica.

Passwords are hashed with Node's built-in `crypto.scrypt` (`scrypt$<saltHex>$<hashHex>`,
64-byte derived key, default N/r/p cost params) — no new dependency, matches
the recommendation left in the schema section. Session and one-shot tokens
are opaque `base64url(randomBytes(32))` strings; only their sha256 hash is
ever stored (`sessions.token_hash`, `tokens.token_hash`), so a database read
never yields a live, directly usable credential.

### GraphQL accepts a session cookie

The GraphQL endpoint (and every other gateway route gated by `isAuthorized`)
accepts four credential sources side by side: the static `MCP_TOKEN`
bearer, an OAuth bearer token, a `marrow_session` cookie, and (`T-MEMORY-047`)
a personal API token bearer -- see "Personal API tokens" below. Each
source's scope (see "Scopes: read / write / admin" below) is checked on
every request, not just for OAuth. When a session or a personal token is
present, the request's `clientId`/`clientLabel` (used for `gateway_clients`
tracking and event logging) become `user:<id>` / `<email>` instead of
`anonymous:<requestId>` -- identically for both sources, since a personal
token IS that specific user connecting programmatically.

The GraphQL WS subscription transport (`T-MEMORY-042`, see
`docs/GRAPHQL_API.md`'s "Subscriptions" section) is stricter than the HTTP
endpoint above: it accepts **only** the `marrow_session` cookie, never the
static `MCP_TOKEN` or an OAuth bearer. A WS upgrade with no session, or an
invalid/expired one, is refused inside `graphql-ws`'s `onConnect` before the
handshake ever reaches `connection_ack` -- see `startGatewayServer` in
`src/gateway/http-server.ts`.

## Scopes: read / write / admin (`T-MEMORY-029` / `D-MEMORY-007`)

Every gateway request resolves to exactly one scope tier before dispatch,
independent of which of the four credential sources it used. Each tier is a
strict superset of the one before it (`admin` implies `write` and `read`).

| Auth source | Scope | Why |
|---|---|---|
| static `MCP_TOKEN` | `admin` | Unchanged from before this task — existing Claude Code / ChatGPT configs must keep working after the upgrade with zero edits. See "MCP_TOKEN migration" below for how this got a stable, owned credential row. |
| no token configured at all (`source:"none"`) | `admin` | Unchanged — this is already a fully-open dev/trusted mode; scopes add no extra protection on top of "anyone can already call anything." |
| session cookie, `role=admin` | `admin` | — |
| session cookie, `role=member` | `write` | Decision 1: session scope is derived straight from the user's role, no separate "elevate to admin" UX — the web UI has no destructive UI to elevate into anyway (`D-MEMORY-015`). |
| personal API token, owner `role=admin` (`T-MEMORY-047`) | `admin` | Same role-derived resolution as a session cookie — see "Personal API tokens" below. |
| personal API token, owner `role=member` (`T-MEMORY-047`) | `write` | Same role-derived resolution as a session cookie. A personal token IS that specific user connecting programmatically, not a separate, wider-scoped credential class. |
| OAuth bearer (Claude Code / ChatGPT connectors) | role-derived, identical to a session's (`T-MEMORY-0xx` SSO, supersedes decision 2 below) | `/oauth/authorize` now requires a real Marrow login (`marrow_session`) instead of the old shared magic token — see `docs/OAUTH_FACADE_FOR_CHATGPT_APPS.md`'s "Session-based authorize (SSO)" — so the issued JWT's `sub` is the real logged-in user's `userId`, not the old hardcoded `"project-memory-user"` literal. `http-server.ts`'s `resolveScopeTier()` resolves that user's *current* role fresh from `users` on every request (never cached in the token): `admin` role → `admin` tier, `member` role → `write` tier, same as a session or personal token. A `sub` that doesn't resolve to an active user (disabled/deleted account, or a still-valid pre-SSO token with the old hardcoded `sub`) fails closed as `401 unauthenticated`, never silently downgraded to `write`. ~~Decision 2 (original text, kept for history): an OAuth-issued token never gets `admin`, regardless of the underlying human's role — deliberate protection against an agent hallucinating a delete call, since the old magic-token flow had no way to prove who was behind the token.~~ That rationale no longer applies once the authorize step verifies real identity; the elevation mechanism below is unaffected and still covers the member-role-OAuth case. |

`admin` covers every hard-delete operation: `memory.delete`, `decision.delete`,
`project.delete`, `event.delete`, `link.delete`, `artifact.delete`,
`task.delete`, `gateway.client_forget`, `gateway.client_prune`, and their
GraphQL mutation equivalents (`deleteMemory`, `deleteDecision`,
`deleteProject`, `deleteEvent`, `deleteLink`, `deleteArtifact`, `deleteTask` —
`gateway.client_forget`/`client_prune` have no GraphQL mutation, so nothing to
list there). Every other tool that used to require `memory:write` still only
requires `write` — creating, updating, and archiving records is unaffected.
`GatewayToolSpec.access` in `src/gateway/tool-definitions.ts` is the source of
truth for each tool's tier; `gatewayToolRequiredScopes()` there maps it to the
concrete scope strings. `src/gateway/graphql.ts`'s `graphqlRequiredScopes()`
mirrors this for GraphQL: the generic `/\bmutation\b/i` text check alone
cannot tell a delete apart from a create/update, so a second, name-specific
check (`ADMIN_GRAPHQL_MUTATION_NAMES`) requires `memory:admin` for exactly
those seven mutation names.

A request with a valid credential but an insufficient scope gets a clear,
distinguishable error, not the same generic "missing or invalid token"
response an actually-missing/invalid credential gets: HTTP 403 (401 for a
genuinely missing/invalid credential), `AppError` code `INSUFFICIENT_SCOPE`,
message `"This operation requires <tier> scope; your credential has <tier>."`
On the MCP JSON-RPC transport this is error code `-32002` (vs `-32001` for no
credential at all). See `docs/GRAPHQL_API.md` and `docs/MCP_TOOLS.md` for the
exact shapes.

## Step-up admin elevation (`T-MEMORY-041` / `D-MEMORY-019`)

This was originally an *addition* on top of a hard OAuth-never-admin ceiling
(`D-MEMORY-017` decision 2), for the one realistic case that standing model
didn't have an answer for: an admin, chatting with an agent connected over
OAuth (Claude Code, ChatGPT), wants to *live, in that moment*, authorize the
one destructive call the agent is proposing — without switching to a
separate admin-scoped client. Since `T-MEMORY-0xx` (SSO), an admin-role
user's OAuth token reaches admin-tier tools directly via `resolveScopeTier()`
(see the scope table above), so this door is no longer the *only* path for
that scenario — but it still matters for a member-role user's OAuth session,
which still resolves to `write` and still needs a live admin password+TOTP
to reach an admin-tier call in the moment. Every request from a source this
mechanism doesn't apply to behaves exactly as before
(`scripts/smoke-gateway-elevation.ts` covers both the still-capped member
case and the now-direct admin case).

Two steps:

1. **Mint a grant**: `POST /auth/elevate` (see the route table above) with
   `{ email, password, code }` for a specific `role=admin`,
   `status=active`, `totp_enabled=true` account. This is a full
   re-authentication (password *and* the current 6-digit TOTP code, both
   checked fresh at that moment), not a lookup against any existing session
   or OAuth token — deliberately, since the OAuth-connected agent that
   actually needs this in the motivating scenario has no `marrow_session`
   cookie to present, and `gateway_clients.owner_user_id` (the "which human
   owns this credential" column added by `T-MEMORY-029`) is only ever
   populated for the migrated static `MCP_TOKEN` credential today, not for
   OAuth connector credentials — so there is no existing "this OAuth client
   belongs to admin X" link to authenticate against instead. Re-deriving
   identity from scratch sidesteps that gap. On success: a JSON body
   `{ token, expiresAt }`. `token` is an opaque, high-entropy secret shown
   exactly once, same "never store the raw secret" handling as `sessions`/
   `tokens` — only its sha256 hash lives in the new `admin_elevations`
   table (migration `011_admin_elevations.cjs`).
2. **Redeem it**: attach the token as an `X-Project-Memory-Elevation`
   header on the actual admin-tier gateway call (`/call`, `/mcp`, or
   `/graphql` — the check lives once, in `isAuthorizedForScopes()` in
   `http-server.ts`, so all three transports get it for free). The grant is
   **single-use** (one atomic `UPDATE ... WHERE used_at IS NULL ...
   RETURNING` in `auth.ts`'s `consumeElevation` — no read-then-write race
   between two concurrent redemption attempts) and expires after **60
   seconds** if never redeemed at all (`admin_elevations.expires_at`,
   `ELEVATION_TTL_MS` in `auth.ts`). Either condition failing — wrong/
   unknown token, already used, expired — is indistinguishable from the
   outside: the call is denied with the same `INSUFFICIENT_SCOPE` 403 an
   OAuth token gets for an admin-tier call with no elevation at all. The
   grant only ever substitutes for the missing `memory:admin` claim; the
   OAuth bearer's own `memory:read`/`memory:write` scopes are still checked
   independently, so a valid-looking elevation header can never rescue an
   otherwise missing or expired bearer token.

A `role=member` account can never mint a grant at all — `requestElevation`
in `auth.ts` checks `role === "admin"` after the password/TOTP checks
succeed, and rejects with a distinct `"Elevation is only available to admin
accounts."` message (not the generic invalid-credentials message, since
this is the account owner asking about their own role, not an attacker
probing for account existence). A `role=admin` session already gets
`memory:admin` directly (decision 1 in the scope table above) and never
needs to go through this flow; elevation is checked only on the
OAuth-sourced branch of `isAuthorizedForScopes()`, so a session's own tier
resolution is completely unaffected by any of this.

### Diagnosing the 403 that motivated this task

Before building any of the above, this task's acceptance criteria required
first checking whether the 403 that prompted it (an agent's `project.delete`
call being blocked mid-chat) actually came from this gateway's own scope
layer at all. It did not, as far as this codebase can show: every
`INSUFFICIENT_SCOPE` denial this gateway produces is a structured JSON body
— `{ ok: false, error: { code: "INSUFFICIENT_SCOPE", message: "This
operation requires <tier> scope; your credential has <tier>.", details: {
requiredScope, grantedScope } } }` (`fail()` in
`src/shared/mcp/tool-response.ts`, wrapping `AppError` — see
`docs/GRAPHQL_API.md`/`docs/MCP_TOOLS.md` for the exact shape on each
transport). The blocking message reported in that session ("blocked by a
firewall or security service") does not match that shape at all — no `ok`
field, no `error.code`, prose instead of a structured JSON error — which is
characteristic of a client-/harness-side network or tool-use safety
classifier (i.e. something in the calling agent's own runtime deciding not
to let the request through), not of anything in this gateway's request
path. This distinction matters because it changes what this task can
actually fix: **the step-up elevation mechanism above only ever helps when
the block is `INSUFFICIENT_SCOPE` from this gateway.** If a given 403 is
instead the calling harness's own classifier refusing to send the request
in the first place, no backend-side mechanism — elevation grants included —
changes that outcome, because the gateway never sees the request at all.
Confirming which case applies to any specific blocked call requires
inspecting that call's actual response body (structured `INSUFFICIENT_SCOPE`
JSON vs. harness prose) at the time it happens; this codebase has no way to
distinguish the two after the fact, since a harness-level block never
reaches the gateway to be logged.

### Smoke coverage

`npm run smoke:gateway:elevation` (built as
`scripts/smoke-gateway-elevation.ts`) covers, against a real gateway/
Postgres instance with both a session (`auth`) and OAuth (`oauth`) facade
configured: minting a real read+write OAuth bearer token (same shape a
Claude Code/ChatGPT connector would carry) → confirming an admin-tier call
with no elevation header is still denied exactly as before this task
(regression check on `D-MEMORY-017` decision 2) → `POST /auth/elevate`
rejecting a wrong password, a wrong TOTP code (distinct message), and a
fully-correct `role=member` account (distinct message) → a correct
password+TOTP mint succeeding → the resulting grant, attached via
`X-Project-Memory-Elevation`, authorizing exactly one `memory.delete` call
over the OAuth bearer → reusing that same (now-consumed) grant being denied
→ a separately-minted grant, backdated in the database, being denied as
expired → and an unrecognized/garbage token in the header being denied
cleanly rather than erroring. (Not wired into `package.json` as an npm
script by this task — run directly via
`node dist/scripts/smoke-gateway-elevation.js` after `npm run build`, same
as every other script in `scripts/`; adding the `npm run smoke:gateway:*`
alias is left to whoever next touches `package.json`, which is outside this
task's allowed files.)

## Personal API tokens (`T-MEMORY-047`)

A third bearer-auth source, alongside the shared static `MCP_TOKEN` and OAuth
connector tokens, scoped to exactly one user -- so a newly admin-approved
user can connect Claude Code / Codex over the gateway's Streamable HTTP
transport without separately asking an admin for the shared `MCP_TOKEN`
(`D-MEMORY-007`'s "individual credentials localize revocation": revoking one
user's personal token no longer means rotating a secret every other client
also depends on). Motivated by a gap this codebase's own Connect manual
(`T-MEMORY-040`) exposed: its Claude Code / Codex instructions showed
`export MARROW_MCP_TOKEN="<gateway-token-from-your-admin>"`, implying every
newly self-registered-and-approved user had to separately ask an admin for
the one shared credential -- the exact thing individual credentials are
supposed to avoid.

- **Table**: `personal_tokens` (migration `013_personal_tokens.cjs`) --
  `id`, `owner_user_id` (FK -> `users`, `UNIQUE`, cascade-deleted with the
  user -- one live token per user, not a list like `git_credentials`),
  `token_hash`, `token_hint`, `created_at`, `last_used_at` (nullable).
- **Hash-only, not encrypted.** Unlike `users.totp_secret` and
  `git_credentials.token_enc` (which must be recoverable in plaintext
  server-side to do their job -- rendering a QR code, calling an outbound
  GitLab API), a personal token is only ever *verified* on each request,
  never redisplayed -- so it follows the `sessions.token_hash` /
  `tokens.token_hash` / `admin_elevations.token_hash` convention instead:
  only `sha256(rawToken)` is stored, via the same `hashToken`/`newOpaqueToken`
  helpers `auth.ts` already uses for sessions and one-shot tokens. There is
  therefore no new `*_ENC_KEY` environment variable for this feature -- it
  has nothing to decrypt.
- **`token_hint`** is a deliberate, narrow exception: the token's last 4
  characters, stored in the clear at generation time, purely for UI
  recognition (e.g. "...a1b2" so a user can tell which of their own tokens an
  integration is using) -- the same low-risk hint `git_credentials` already
  exposes (`tokenHint` in `git-credentials.ts`), computed there from the
  decryptable ciphertext at read time; computed here at write time instead,
  since `personal_tokens` has no decryptable form to recompute it from later.
- **Shown once, then regenerate-only -- no persistently-visible token.**
  This task's own record flagged the display model as an open question
  ("shown once with regenerate" vs. "persistently visible, risking
  shoulder-surfing"), to be resolved during implementation. Resolved as
  shown-once + regenerate, for consistency with this codebase's two existing
  precedents for exactly this kind of secret: the TOTP secret
  (`/auth/2fa/enroll`) and 2FA recovery codes (`/auth/2fa/confirm`,
  `/auth/2fa/recovery-codes/regenerate`) are both shown exactly once at
  generation time and never again, with a regenerate path for after. A
  database read (backup, replica, log) never yields a usable personal token,
  same as those.
- **One endpoint serves both "Generate" and "Regenerate".**
  `POST /auth/profile/personal-token/regenerate` (session cookie required)
  always issues a fresh token, replacing any existing row for that user in
  one transaction ("replace, don't mutate, a secret row" -- the same
  convention this codebase already uses for recovery codes and git
  credentials) and returning the raw token, its hint, and `createdAt`
  exactly once. There is no separate "create" vs. "regenerate" route: the
  frontend's Connect section (`front/src/pages/profile/index.tsx`) just
  labels the button "Generate" when no token currently exists and
  "Regenerate" once one does, calling the same endpoint either way.
  `GET /auth/profile/personal-token` (session cookie required) is
  side-effect-free status only -- `{ exists, tokenHint, createdAt,
  lastUsedAt }`, never the raw token -- so polling it can never accidentally
  mint or leak a secret.
- **Generation is lazy, on first visit to the profile's Connect section --
  not automatic at admin-approval time.** The task record explicitly left
  this as an implementation choice ("generate at approve time, or lazily on
  first visit, if no token exists yet"). Approve-time generation was
  rejected here: with shown-once semantics and no SMTP configured for this
  gateway (see "No SMTP sending yet" below), a token minted server-side at
  the moment an admin clicks "Approve" has no channel to ever reach the
  approved user's browser -- the admin's own response never carries it (an
  admin is not that token's owner), and there is no email to relay it
  through either. Such a token would just be an immediately-orphaned row the
  user would have to regenerate the instant they first visited Connect
  anyway. Instead, the Connect section calls `GET
  /auth/profile/personal-token` on mount and, if `exists: false`,
  automatically calls the regenerate endpoint once to produce and display a
  token the user actually sees -- still an explicit `POST`, not a side
  effect of the `GET`. This still satisfies the acceptance criterion ("sees
  their own token immediately after approval, without asking an admin"): the
  token appears the moment they first open their own profile after logging
  in, no separate request to anyone required.
- **Scope tier: role-derived, identical to a session's** (`admin` role ->
  `admin` scope, `member` role -> `write` scope) -- see the scope table
  above and `resolveScopeTier()` in `http-server.ts`. `identifyPersonalToken()`
  in `auth.ts` resolves a `Authorization: Bearer <token>` header to the same
  `SessionIdentity` shape `identifyFromRequest()` (the session-cookie path)
  returns, so every downstream consumer of that shape treats the two
  sources alike without a separate code path. Only an `active` user's token
  resolves -- disabling or deleting a user immediately stops their personal
  token from authenticating too, no separate revocation step.
- **Project-membership filtering (`T-MEMORY-029`) applies to a personal
  token exactly like a session -- deliberately NOT bypassed the way OAuth,
  the static token, and anonymous callers are.** A personal token is that
  specific user, connecting programmatically; `http-server.ts`'s
  `requestContext()` populates `GatewayRequestContext.sessionUserId`/
  `sessionRole` from a resolved personal token exactly the way it does from
  a session cookie (`identity = sessionAuth ?? personalTokenAuth`), so
  `assertProjectMember()`/`applyProjectMembershipFilter()` in
  `pg-tool-service.ts` -- which key off those two fields alone -- apply
  unchanged, with zero new code in that file.
- **Git-credential *management* is the one deliberate exception: it stays
  browser-session-only, not extended to a personal-token bearer for the same
  user.** `git.credential_create`/`git.credential_delete`'s existing
  `requireSessionUserId()` (see "Git host credentials" below) was written
  before this task to mean "a real browser session cookie", enforcing that a
  raw git PAT only ever enters or leaves storage through the trusted browser
  profile UI, never through an agent. Populating `sessionUserId` identically
  for personal-token requests (needed for scope/membership parity above)
  would have silently widened that boundary -- an agent connected with a
  user's own personal token could then mint/delete that user's git
  credentials too. To avoid that, `GatewayRequestContext` gained one more
  field, `sessionSource: "cookie" | "personal_token" | undefined`, and
  `requireSessionUserId()` now additionally requires `sessionSource ===
  "cookie"`. Every other `sessionUserId` consumer (scope-tier resolution,
  project-membership filtering, and git-credential *reads*'
  `resolveGitCredentialReader()`, which intentionally still resolves a
  personal-token bearer to that user's own credentials rather than falling
  back to the instance admin the way OAuth/static-token callers do) does not
  check `sessionSource` and treats both sources alike.
- **No MCP tool or GraphQL mutation manages this** -- only the two REST
  routes above, both session-cookie-gated, mirroring password/2FA/
  git-credential management rather than the tool-call surface.

### Smoke coverage

`scripts/smoke-gateway-personal-tokens.ts` covers, against a real gateway/
Postgres instance: `GET`/`POST regenerate` both requiring a session (401
without one) → a freshly-active user having no token yet (`exists: false`,
confirming the lazy-on-first-visit design over approve-time generation) →
regenerate returning a raw token exactly once, with only its sha256 hash and
a last-4 hint ever persisted → the status endpoint never re-exposing the
full token after that → the token authenticating over `Authorization:
Bearer` on `/call` with a role-derived scope tier identical to a session's
(a member's token getting `INSUFFICIENT_SCOPE` on `memory.delete`, an
admin's token succeeding) → project-membership filtering applying to a
member's personal token exactly like their session would (not bypassed) →
regenerate invalidating the previous token immediately (old token 401s,
exactly one row per user afterward) → git-credential *management* staying
denied ("logged-in session" required) even over a valid personal-token
bearer for the same user → and git-credential *reads* resolving directly to
that bearer's own owner rather than the OAuth/static-token admin-fallback.
Not wired into `package.json` as an `npm run smoke:gateway:*` alias by this
task (`package.json` is outside this task's allowed files) -- same
precedent `scripts/smoke-gateway-elevation.ts` set; run directly via `node
dist/scripts/smoke-gateway-personal-tokens.js` after `npm run build`.

## Git host credentials (`T-MEMORY-044`)

Per-user, per-host git credentials (GitLab personal access tokens today --
the schema is host-per-row so other git hosts could be added later without a
migration, but that is explicitly out of scope for this pass) plus a
read-only server-side proxy for pipeline status, so an agent can check CI/CD
without ever holding the raw token or needing SSH access to the runner host
(the motivating problem this task's own record describes: monitoring CI/CD
via `ssh` + `journalctl` grep on production, and the owner's explicit
rejection of putting a PAT in `.env`).

- **Table**: `git_credentials` (migration `012_git_credentials.cjs`) --
  `id`, `owner_user_id` (FK -> `users`, cascade-deleted with the user),
  `host`, `label`, `token_enc`, `created_at`, `updated_at`, `last_used_at`
  (nullable). No uniqueness constraint on `(owner_user_id, host)` --
  deliberately, to allow a brief overlap during rotation; `git.pipeline_status`
  picks the most recently created row when more than one exists for a given
  `(owner, host)` pair.
- **Encryption**: AES-256-GCM, same cipher/on-disk format as
  `users.totp_secret` (`base64(iv):base64(authTag):base64(ciphertext)`), but
  under its **own** key -- `GIT_CREDENTIAL_ENC_KEY`, not `TOTP_ENC_KEY`. The
  generic cipher logic was extracted out of `totp.ts` into `crypto.ts`
  (`aesGcmEncrypt`/`aesGcmDecrypt`/`loadAesGcmKey`) so both secret classes
  share the exact same implementation without copy-pasting it; `totp.ts`'s
  `encryptSecret`/`decryptSecret` are now thin wrappers over `crypto.ts`,
  unchanged in behavior. `src/gateway/git-credentials.ts` owns the
  git-specific wrapping (`encryptGitToken`/`decryptGitToken`) and the
  outbound GitLab REST client. A missing/invalid/wrong-length
  `GIT_CREDENTIAL_ENC_KEY` fails loudly (`VALIDATION_ERROR`) the same way a
  missing `TOTP_ENC_KEY` does -- it never falls back to writing a plaintext
  token. Rotation is delete-old + create-new (`git.credential_create` /
  `git.credential_delete`); there is no `git.credential_update` for the
  token itself, same "replace, don't mutate, a secret row" pattern this
  codebase already uses for recovery codes.
- **The token is never returned after creation**, on any tool or GraphQL
  field, by any caller: `git.credential_create`'s response is `{id, host,
  label, createdAt}`; `git.credential_list`'s is the same shape plus
  `lastUsedAt` and an optional `tokenHint` (the token's last 4 characters
  only -- for UI recognition, never enough to reconstruct or brute-force the
  original). The GraphQL `GitCredential` type has no `token` field declared
  at all, so even if a resolver's underlying object carried one, GraphQL's
  own field selection would never expose it.
- **Ownership resolution: session-only for managing credentials, admin-owned
  fallback for reading them.** `git.credential_create` and
  `git.credential_delete` (and their GraphQL equivalents) resolve
  `owner_user_id` **exclusively** from `context.sessionUserId` -- a real
  `marrow_session` browser cookie. A raw token should only ever enter or leave
  storage through the trusted browser profile UI, so static `MCP_TOKEN`,
  OAuth-connected agents (Claude Code, ChatGPT), and any other non-session
  caller hit `AppError("UNAUTHORIZED", "...caller can manage credentials")`
  for those two.
  `git.credential_list` and `git.pipeline_status` are different: this is a
  single-owner/small-team self-host instance, and the entire point of this
  feature was letting an agent connected through Marrow check CI status
  instead of the operator SSH-ing into the deploy host and grepping
  `journalctl` by hand (see `I-MEMORY-031`/`I-MEMORY-034` for that
  friction). So for these two *read-only* paths, a non-session caller falls
  back to the instance's primary admin -- `resolveGitCredentialReader()` in
  `pg-tool-service.ts`, the same "earliest-created `role=admin` user" lookup
  `ensureStaticTokenCredential()` already uses to give the migrated static
  token an owner. A browser session's own user id still takes precedence
  whenever one is present (so a `role=member` session reads *its own*
  credentials, not the admin's). `gateway_clients.owner_user_id` still isn't
  populated for OAuth connector credentials specifically -- this fallback
  sidesteps that gap for git credentials rather than solving it in general;
  a future feature needing a real per-OAuth-connector owner link still has
  that as open work.
- **Scope tier: `write`, not `admin`, including for `git.credential_delete`**
  -- a deliberate deviation from this codebase's usual
  *.delete-is-always-`admin`* convention (see "Scopes: read / write /
  admin" above). That convention protects shared/team-visible records from
  an OAuth-connected agent hallucinating a destructive call; a git
  credential is neither shared nor reachable by an OAuth-connected agent at
  all (the session requirement above already forecloses that caller class
  entirely, regardless of scope), and `deleteGitCredential`'s `WHERE id = ?
  AND owner_user_id = ?` means the only thing any session can ever delete is
  its **own** credential. Requiring `admin` scope on top would only block an
  ordinary `role=member` user from managing their own profile -- which the
  task's own acceptance criteria (a delete button in every user's own
  profile, not an admin panel) rules out. `git.credential_delete` is
  therefore **not** in `ADMIN_GRAPHQL_MUTATION_NAMES`.
- **`git.pipeline_status(host, project, ref?)`**: resolves the caller's own
  stored credential for `host` (most-recently-created row if more than one
  matches), then calls that GitLab instance's REST API server-side --
  `GET /api/v4/projects/:id_or_path/pipelines?ref=...` for the latest
  pipeline, then `GET .../pipelines/:id/jobs` for its jobs -- using the
  decrypted token in a `PRIVATE-TOKEN` header. The raw token never leaves
  the server; the tool returns only `{status, ref, sha, webUrl, jobs:
  [{name, status}]}`. No credential stored for that host -> a clear
  `GIT_CREDENTIAL_REQUIRED` error ("No credential stored for host X, add one
  in your profile first"), not a silent failure or an empty result.
  GitLab itself rejecting the stored token (401/403, e.g. expired/revoked)
  surfaces as a distinct `UNAUTHORIZED` naming the host, not a generic
  network error. `last_used_at` is stamped on the resolved credential after
  a successful call. The outbound HTTP call is made through an injectable
  `GitHttpFetch` (`PgToolService`'s constructor, defaulting to the real
  global `fetch`) specifically so `scripts/smoke-gateway-git-credentials.ts`
  can substitute a fake and never touch a real GitLab instance.
- **Not in scope for this task** (per the task record): non-GitLab hosts,
  any write/trigger/cancel operation against CI/CD (only read-only pipeline/
  job status), and a UI/API for managing git repositories themselves
  (clone, push, etc).

### Smoke coverage

`npm run smoke:gateway:git-credentials`
(`scripts/smoke-gateway-git-credentials.ts`) covers, against a real gateway/
Postgres instance with a fake (never-real-network) GitLab HTTP client
injected into `PgToolService`: the credential create -> list -> delete round
trip → the token never appearing in any create/list/GraphQL response →
encryption actually happening (the stored `token_enc` differs from, and
never contains, the raw token; decrypting it recovers the exact original) →
`git.credential_list` scoped to the caller's own rows only → one member
session being unable to delete another member's credential
(`GIT_CREDENTIAL_NOT_FOUND`, not a leak) → `git.pipeline_status` failing
clearly (`GIT_CREDENTIAL_REQUIRED`) for a host with no stored credential,
without even attempting an outbound call → a successful (faked) pipeline
status call, including the `last_used_at` stamp → a GitLab-side 401 (stale
token) surfacing as a distinct `UNAUTHORIZED` → an admin-role session
managing its own credentials at `write` tier (no elevation needed) → the
GraphQL `createGitCredential`/`gitCredentials`/`gitPipelineStatus`/
`deleteGitCredential` equivalents, including that the GraphQL type never
exposes a token field → a static-token and an OAuth-bearer request both
being denied on `git.credential_create` (`"...can manage credentials"`)
even though both otherwise carry sufficient scope → and, the actual
motivating case, an OAuth-bearer request to `git.credential_list` and
`git.pipeline_status` succeeding by falling back to the instance admin's
own stored credential and returning real (faked) pipeline data.

## Project membership: `project_members` (`T-MEMORY-029` / `D-MEMORY-007`)

`project_members` (migration `010_scopes_membership_attribution.cjs`) is a
plain `(project_id, user_id)` set — composite primary key, no per-row
metadata, no in-project permission matrix. Membership answers exactly one
question: can this `role=member` session see this project at all.

- **Only `role=member` sessions are ever filtered.** `role=admin` sessions
  and every non-session auth source (static `MCP_TOKEN`, OAuth, the
  no-token/`none` dev mode) bypass this check entirely and see every
  project, unchanged from pre-`T-MEMORY-029` behavior (decision 3).
- **Common (`project_id = null`) is never filtered**, for anyone. Membership
  only applies to a concrete project.
- A member without a `project_members` row for a project gets the same
  `PROJECT_NOT_FOUND` a genuinely nonexistent project id would produce, from
  `project.get`, `project.list`, `project.resolve`, and every read/write tool
  that resolves a project (`memory.search`, `task.list`, `decision.list`,
  `artifact.list`/`search`, `event.list`, `preflight`/`preflight.by_query`,
  `context.pack`, `handoff.latest`/`search`, and the write paths that accept
  a `project` argument). Existence is never leaked — same don't-distinguish-
  why convention as `/auth/login`'s single "Invalid email or password"
  message for both "no such user" and "wrong password".
- Implemented as one centralized gate in `PgToolService`: `getProject()`
  (used by every project resolution path, directly or via `resolveProject()`
  / `currentProject()` / `tryCurrentProject()`) calls `assertProjectMember()`
  after fetching the row. List/search-shaped queries (`project.list`,
  `project.resolve`) use the query-builder counterpart,
  `applyProjectMembershipFilter()`, instead of a per-row check.
- There is currently no API to manage `project_members` rows (add/remove a
  member from a project) — this task ships the schema and the enforcement,
  not a membership-management UI/route. Rows are inserted directly for now;
  a management surface is expected follow-up work, not part of this task's
  scope.

## Event attribution: `credentialId` (`T-MEMORY-029` / `D-MEMORY-007`)

Every event row already stored `created_by` (the acting `clientId`) --
`recordEventForProject()` has always written it. It was simply never surfaced
in the API response. `eventOut()` in `pg-tool-service.ts` now exposes it as
`credentialId`, consistently across `event.record`'s response, `event.list`,
`event.get`, and GraphQL's `Event.credentialId` field. Value shape matches
`clientId`: `user:<userId>` for a session-attributed event, `static:mcp-token`
for the shared static credential, or an OAuth/anonymous client id for those
sources.

## MCP_TOKEN migration (`T-MEMORY-029` / `D-MEMORY-007`)

The shared `MCP_TOKEN` bearer is migrated into a real, scoped
`gateway_clients` credential row on every gateway startup (`src/gateway.ts`,
right after `MCP_TOKEN` is read from the environment), not by
`pm3m admin create` (see "Bootstrap" above). `PgToolService.ensureStaticTokenCredential()`
idempotently upserts `gateway_clients`:

- `id`: the fixed literal `static:mcp-token` — not derived from the token's
  own value, so it stays the same across a token rotation. This is also the
  fix for the credential having no stable identity at all before this task:
  a static-token request with no explicit `x-project-memory-client-id`
  header used to fall through to a fresh `anonymous:<requestId>` on *every
  single request*; it now resolves to this one stable id every time.
- `scope`: always `admin`.
- `owner_user_id`: the earliest-created `role=admin` user (`ORDER BY
  created_at LIMIT 1`), or `null` if no admin exists yet (e.g. before the
  first `/auth/bootstrap` or `pm3m admin create`).

The upsert (`.onConflict("id").merge(...)`) only ever touches `scope` and
`owner_user_id` — it deliberately never touches `last_seen_at`, which stays
driven only by real request traffic through the existing `touchClient()`
upsert (same table, disjoint set of merged columns, so the two upserts never
fight over the same field). Safe to run on every restart; a no-op in effect
once an admin already owns the row.

### No SMTP sending yet

`POST /auth/invite` and `POST /auth/claim` always return the link/token in
the JSON response body rather than emailing it — there is no SMTP client
wired up. This is a deliberate, honest "no SMTP configured" degradation
rather than a partial implementation: the admin (for invites) or the newly
claimed user's own browser (for verify-email, since the claim response
already came back to them) relays the link. Adding real SMTP delivery
(env vars, a mail library, templates) is future work, not silently assumed
to exist. The self-registration path below has the same property, but for a
different reason: it doesn't need SMTP as a trust channel at all, because
TOTP enrollment is a real proof of second-factor ownership, not a stand-in
for one.

### TOTP 2FA (`src/gateway/totp.ts`)

RFC 4226 (HOTP) / RFC 6238 (TOTP) implemented directly on `node:crypto` — no
new npm dependency, the same "no new dependency" choice already made for
password hashing. HMAC-SHA1, 6 digits, 30-second step, current step ±1
accepted (3 codes total) to tolerate clock drift between the server and the
authenticator app.

- **Enrollment is two calls**: `POST /auth/2fa/enroll` generates the secret
  and stores it encrypted (`totp_enabled` stays `false`); `POST
  /auth/2fa/confirm` proves the applicant actually captured it correctly
  before `totp_enabled` flips to `true` and recovery codes are minted. This
  is shared code (`enrollTotp`/`confirmTotp` in `auth.ts`) used both by the
  profile bind flow and, with its own routes, by open self-registration
  below.
- **At rest, `users.totp_secret` is ciphertext, never plaintext.** AES-256-GCM,
  keyed by the `TOTP_ENC_KEY` env var (32 raw bytes, base64-encoded — generate
  with `openssl rand -base64 32`). Stored format is self-describing:
  `base64(iv):base64(authTag):base64(ciphertext)`. If `TOTP_ENC_KEY` is
  missing, not valid base64, or doesn't decode to exactly 32 bytes, every
  TOTP-touching route (`/auth/register`, `/auth/register/confirm`,
  `/auth/2fa/enroll`) fails immediately with a clear `VALIDATION_ERROR` —
  it never falls back to writing a secret in the clear.
- **Recovery codes** (`totp_recovery_code_hashes`, `text[]`): 10 codes, 10
  base32 characters each (50 bits of entropy), grouped as `XXXX-XXXX-XX` for
  readability, shown to the user exactly once (at `/auth/2fa/confirm`,
  `/auth/register/confirm`, or `/auth/2fa/recovery-codes/regenerate`). Only
  their sha256 hashes are stored — same fast-hash choice as `tokens.token_hash`,
  since recovery codes are high-entropy random strings rather than
  user-chosen passwords, so `scrypt` isn't needed. A recovery code is
  single-use: a successful `/auth/login/2fa` match with one deletes that
  hash from the array.
- **Login is two steps** once `totp_enabled=true`: `POST /auth/login`
  returns `{ status: "pending_totp", userId }` instead of a session cookie,
  and the frontend calls `POST /auth/login/2fa` with either a fresh 6-digit
  code or an unused recovery code to actually get the session.
- Available to every role, including `admin` — this is the only path a
  bootstrap admin (`/auth/bootstrap`, which stays password-only by decision)
  can ever get 2FA, since it isn't created through either registration flow.

### Open self-registration + admin approval (`D-MEMORY-016`)

A second, parallel entry point alongside invite→claim→verify-email — not a
replacement for it. Where invite requires an admin to act first (pre-approval),
open registration lets anyone create an account and compensates with a
mandatory inline TOTP enrollment plus manual admin approval after the fact
(post-approval); the two are treated as equally strong gates, just at
opposite ends of the flow.

1. `POST /auth/register` (email + password) generates a TOTP secret and
   parks everything in `pending_registrations` (30-minute TTL) — no `users`
   row yet, same "don't create the row until the flow really completes"
   principle the invite path uses for its own tokens.
2. `POST /auth/register/confirm` (token + TOTP code) is the actual
   proof-of-ownership step. Only on success does the real `users` row get
   created, with `status='pending_approval'` (the third value added to
   `users.status`'s check constraint by migration `009_totp_registration.cjs`)
   and `totp_enabled=true` from the moment it exists. `email_verified_at`
   is left permanently `null` for these accounts — that concept belongs to
   the invite path's email-link trust model, and self-registration doesn't
   use it; `auth.ts`'s `login()` skips the "please verify your email" check
   whenever `totp_enabled` is already `true`; for the invite path that stays
   equivalent to today's behavior since a freshly-claimed invite always has
   `totp_enabled=false` until someone opts into 2FA afterwards.
3. The account cannot log in at all until an admin calls `POST
   /auth/admin/pending-users/:id/approve` (→ `status=active`) or `.../reject`
   (→ `status=disabled`), seen via `GET /auth/admin/pending-users`. Login
   attempts while `pending_approval` get a distinct message ("Your account
   is waiting for admin approval.") rather than the generic disabled one —
   that check runs before the disabled check in `login()`, so an operator
   (or the frontend) can tell the two apart.
4. Once approved, the account logs in exactly like any other `totp_enabled`
   account: `/auth/login` → `pending_totp` → `/auth/login/2fa`.

### Smoke coverage

`npm run smoke:gateway:auth` (`scripts/smoke-gateway-auth.ts`) runs the full
invite → claim → verify-email → login → GraphQL-over-session-cookie → logout
flow against the real gateway (ephemeral local instance, real Postgres),
including the negative cases: wrong password, invite without an admin
session, login before claim, login before verification, replaying a claim
token, and GraphQL access after logout.

`npm run smoke:gateway:registration` (`scripts/smoke-gateway-registration.ts`)
covers the open self-registration + TOTP + approval path end to end against
the same kind of real gateway/Postgres instance: register → register/confirm
(wrong code rejected, then the correct code accepts) → login while
`pending_approval` (checks the exact message) → admin approve → login
(`pending_totp`) → `/auth/login/2fa` with a wrong code (rejected) and then a
correct one (session) → a GraphQL call over that session cookie → a
recovery-code login (and confirms the same code can't be reused) → a second
registration + admin reject → login after reject (checks the disabled
message) → an expired register/confirm token → the shared 2FA bind/unbind
profile section (enroll → confirm → recovery-codes regenerate → disable) and
a password change, both exercised against an already-logged-in,
bootstrap-style password-only account → and finally, that `/auth/register`
fails loudly (400, nothing written) when `TOTP_ENC_KEY` isn't configured.

`npm run smoke:gateway:scopes` (`scripts/smoke-gateway-scopes.ts`) covers the
scope/membership/attribution layer end to end against the same kind of real
gateway/Postgres instance: the static token's migration to a stable
`static:mcp-token` credential (same id across repeated calls, `scope=admin`
row, still-working backward-compat admin access) → a `role=member` session
creating successfully (write scope) then getting a clear
`INSUFFICIENT_SCOPE` (403) on `memory.delete`, with the record left in place
→ a `role=admin` session's `memory.delete` actually succeeding → a member
session's `project.list` and `memory.search{project}` both treating a project
it has no `project_members` row for as not-found → an admin session seeing
that same project regardless (membership bypass) → and `event.list` exposing
`credentialId` for an event created by the member's session. `npm run
smoke:oauth` (`scripts/smoke-oauth.ts`) additionally covers the OAuth-side of
decision 2: a token requesting only `memory:read` still gets `memory:write`
(pre-existing `I-MEMORY-019` behavior, unchanged) but is denied
`gateway.client_prune` and the GraphQL `deleteTask` mutation with the same
`INSUFFICIENT_SCOPE` error, over both the REST/MCP and GraphQL transports.
