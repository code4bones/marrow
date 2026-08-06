# AUTH.md

# Auth schema and bootstrap

This is the foundation piece of the per-user access model (see
`docs/AUTH_LAYERING.md` for the edge/proxy layering rule it complements, and
PMem decisions `D-MEMORY-007`, `D-MEMORY-008`, `D-MEMORY-011`). It adds tables
and a bootstrap command; it does not add any HTTP-facing login route yet —
that's the next task in the plan (invites, email verification, login/logout).

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

The `/auth/claim` route itself does not exist yet — this command only
guarantees the token is valid and verifiable (`sha256(token) == tokens.token_hash`,
not expired, not used) for whichever task implements it next.

The existing shared `MCP_TOKEN` is untouched by this bootstrap. Migrating it
into a credential owned by the bootstrap admin is explicitly deferred to the
scopes/attribution task (see PMem `T-MEMORY-029`), not done here.
