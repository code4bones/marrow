# AUTH.md

# Auth schema and bootstrap

This is the per-user access model for PMemUI (see `docs/AUTH_LAYERING.md` for
the edge/proxy layering rule it complements, and PMem decisions
`D-MEMORY-007`, `D-MEMORY-008`, `D-MEMORY-011`, `D-MEMORY-016`). It covers the
schema, the CLI bootstrap command, and the HTTP `/auth/*` routes: the
original invite→claim→verify-email path, session login/logout, TOTP 2FA
(bind/unbind, shared by every role), and open self-registration with inline
TOTP + admin approval. The read/write/admin scope + project-membership layer
is a separate, later task.

## Tables (migration `006_auth_users_sessions_tokens.cjs`)

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
