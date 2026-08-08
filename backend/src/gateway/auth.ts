import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";
import type { IncomingMessage } from "node:http";
import type { Knex } from "knex";
import { AppError } from "../shared/errors.js";
import {
  base32Encode,
  buildOtpauthUrl,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotpCode
} from "./totp.js";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

export const SESSION_COOKIE_NAME = "pmem_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_REGISTRATION_TTL_MS = 30 * 60 * 1000;
const RECOVERY_CODE_COUNT = 10;
// T-MEMORY-041 / D-MEMORY-019: how long a step-up elevation grant is good
// for if it's minted but never redeemed. Deliberately short -- this is a
// "confirm this one action right now" prompt, not a session. A grant is
// also single-use (see consumeElevation's atomic UPDATE below), so in
// practice this TTL is only ever the backstop for a grant nobody redeemed.
const ELEVATION_TTL_MS = 60 * 1000;

export type AuthFacade = ReturnType<typeof createAuthFacade>;

export interface ElevationGrant {
  token: string;
  expiresAt: Date;
}

export interface SessionIdentity {
  sessionId: string;
  userId: string;
  email: string;
  role: string;
  status: string;
  totpEnabled: boolean;
}

interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

type LoginResult =
  | { status: "session"; token: string; user: { id: string; email: string; role: string } }
  | { status: "pending_totp"; userId: string };

type SessionLoginResult = { status: "session"; token: string; user: { id: string; email: string; role: string } };

export function createAuthFacade(db: Knex) {
  async function invite(email: string, invitedByUserId: string): Promise<{ token: string; email: string }> {
    const normalized = normalizeEmail(email);
    const existing = await db("users").where({ email: normalized }).first();
    if (existing) {
      throw new AppError("VALIDATION_ERROR", `A user with email ${normalized} already exists.`);
    }
    const now = new Date();
    const rawToken = newOpaqueToken();
    await db("tokens").insert({
      id: randomUUID(),
      user_id: null,
      email: normalized,
      purpose: "invite",
      token_hash: hashToken(rawToken),
      expires_at: new Date(now.getTime() + INVITE_TTL_MS),
      created_by: invitedByUserId,
      created_at: now
    });
    return { token: rawToken, email: normalized };
  }

  async function claimContext(rawToken: string): Promise<{ email: string | null; purpose: string }> {
    const tokenRow = await activeToken(rawToken, ["invite", "password_reset"]);
    return { email: (tokenRow.email as string | null) ?? null, purpose: tokenRow.purpose as string };
  }

  async function claim(
    rawToken: string,
    password: string
  ): Promise<{ userId: string; email: string; emailVerified: boolean; verifyToken?: string }> {
    if (password.length < 8) {
      throw new AppError("VALIDATION_ERROR", "Password must be at least 8 characters.");
    }
    const now = new Date();
    const tokenRow = await activeToken(rawToken, ["invite", "password_reset"]);
    const passwordHash = await hashPassword(password);
    let userId = tokenRow.user_id as string | null;

    if (tokenRow.purpose === "invite") {
      if (userId) {
        throw new AppError("VALIDATION_ERROR", "This invite has already been used.");
      }
      if (!tokenRow.email) {
        throw new AppError("VALIDATION_ERROR", "This invite is missing a target email.");
      }
      const existingByEmail = await db("users").where({ email: tokenRow.email }).first();
      if (existingByEmail) {
        throw new AppError("VALIDATION_ERROR", `A user with email ${tokenRow.email} already exists.`);
      }
      userId = randomUUID();
      await db("users").insert({
        id: userId,
        email: tokenRow.email,
        password_hash: passwordHash,
        email_verified_at: null,
        totp_enabled: false,
        role: "member",
        invited_by: tokenRow.created_by ?? null,
        status: "active",
        created_at: now,
        updated_at: now
      });
    } else {
      if (!userId) {
        throw new AppError("VALIDATION_ERROR", "This link is not associated with a user.");
      }
      await db("users").where({ id: userId }).update({ password_hash: passwordHash, updated_at: now });
    }

    await db("tokens").where({ id: tokenRow.id }).update({ used_at: now });

    const user = await db("users").where({ id: userId }).first();
    let verifyToken: string | undefined;
    if (!user.email_verified_at) {
      verifyToken = newOpaqueToken();
      await db("tokens").insert({
        id: randomUUID(),
        user_id: userId,
        email: user.email,
        purpose: "verify_email",
        token_hash: hashToken(verifyToken),
        expires_at: new Date(now.getTime() + VERIFY_EMAIL_TTL_MS),
        created_by: userId,
        created_at: now
      });
    }

    return {
      userId: userId as string,
      email: user.email as string,
      emailVerified: Boolean(user.email_verified_at),
      verifyToken
    };
  }

  async function verifyEmail(rawToken: string): Promise<void> {
    const now = new Date();
    const tokenRow = await activeToken(rawToken, ["verify_email"]);
    if (!tokenRow.user_id) {
      throw new AppError("VALIDATION_ERROR", "This verification link is not associated with a user.");
    }
    await db("users").where({ id: tokenRow.user_id }).update({ email_verified_at: now, updated_at: now });
    await db("tokens").where({ id: tokenRow.id }).update({ used_at: now });
  }

  async function login(email: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const normalized = normalizeEmail(email);
    const user = await db("users").where({ email: normalized }).first();
    if (!user || !user.password_hash) {
      // Run the same-cost hash even when there is no user/password to compare
      // against, so responses for "no such user" and "wrong password" take
      // comparable time and don't leak which case it was.
      await hashPassword(password);
      throw new AppError("UNAUTHORIZED", "Invalid email or password.");
    }
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      throw new AppError("UNAUTHORIZED", "Invalid email or password.");
    }
    if (user.status === "pending_approval") {
      throw new AppError("UNAUTHORIZED", "Your account is waiting for admin approval.");
    }
    if (user.status !== "active") {
      throw new AppError("UNAUTHORIZED", "This account has been disabled.");
    }
    // Self-registered accounts (D-MEMORY-016) never verify email — inline
    // TOTP enrollment is their proof-of-ownership instead, and their row is
    // created with email_verified_at permanently null (see registerConfirm
    // below). totp_enabled=true is set at that same moment and never
    // unset by the approval step, so it's a reliable signal that this
    // account belongs to that path and the email-verification gate (which
    // only ever applies to the invite→claim→verify-email path) doesn't
    // apply to it.
    if (!user.totp_enabled && !user.email_verified_at) {
      throw new AppError("UNAUTHORIZED", "Please verify your email before logging in.");
    }
    if (user.totp_enabled) {
      // Second step is POST /auth/login/2fa (loginTotp below) — TOTP code or
      // an unused recovery code, keyed off this userId.
      return { status: "pending_totp", userId: user.id };
    }

    const rawSessionToken = await issueSession(user.id, meta);
    return { status: "session", token: rawSessionToken, user: { id: user.id, email: user.email, role: user.role } };
  }

  async function issueSession(userId: string, meta: RequestMeta): Promise<string> {
    const now = new Date();
    const rawSessionToken = newOpaqueToken();
    await db("sessions").insert({
      id: randomUUID(),
      user_id: userId,
      token_hash: hashToken(rawSessionToken),
      created_at: now,
      expires_at: new Date(now.getTime() + SESSION_TTL_MS),
      last_seen_at: now,
      user_agent: meta.userAgent ?? null,
      ip: meta.ip ?? null
    });
    return rawSessionToken;
  }

  // --- TOTP 2FA: shared bind/unbind profile section (T-MEMORY-028) ---
  // Available to every role, including admin (D-MEMORY-016) — the bootstrap
  // admin has no other path to ever get 2FA, since /auth/bootstrap stays
  // password-only by decision.

  async function enrollTotp(userId: string): Promise<{ otpauthUrl: string; secretBase32: string }> {
    const user = await db("users").where({ id: userId }).first();
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found.");
    }
    if (user.totp_enabled) {
      throw new AppError(
        "VALIDATION_ERROR",
        "TOTP is already enabled on this account. Disable it before enrolling a new device."
      );
    }
    const secretBase32 = base32Encode(generateTotpSecret());
    await db("users")
      .where({ id: userId })
      .update({ totp_secret: encryptSecret(secretBase32), updated_at: new Date() });
    return { otpauthUrl: buildOtpauthUrl(secretBase32, user.email), secretBase32 };
  }

  async function confirmTotp(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await db("users").where({ id: userId }).first();
    if (!user) {
      throw new AppError("NOT_FOUND", "User not found.");
    }
    if (user.totp_enabled) {
      throw new AppError("VALIDATION_ERROR", "TOTP is already enabled on this account.");
    }
    if (!user.totp_secret) {
      throw new AppError("VALIDATION_ERROR", "No TOTP enrollment in progress. Call enroll first.");
    }
    const secretBase32 = decryptSecret(user.totp_secret);
    if (!verifyTotpCode(secretBase32, code)) {
      throw new AppError("UNAUTHORIZED", "Invalid verification code.");
    }
    const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
    await db("users").where({ id: userId }).update({
      totp_enabled: true,
      totp_recovery_code_hashes: recoveryCodes.map(hashRecoveryCode),
      updated_at: new Date()
    });
    return { recoveryCodes };
  }

  async function disableTotp(userId: string, currentPassword: string): Promise<void> {
    const user = await requirePasswordMatch(userId, currentPassword);
    if (!user.totp_enabled) {
      throw new AppError("VALIDATION_ERROR", "TOTP is not enabled on this account.");
    }
    await db("users").where({ id: userId }).update({
      totp_secret: null,
      totp_enabled: false,
      totp_recovery_code_hashes: null,
      updated_at: new Date()
    });
  }

  async function regenerateRecoveryCodes(
    userId: string,
    currentPassword: string
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await requirePasswordMatch(userId, currentPassword);
    if (!user.totp_enabled) {
      throw new AppError("VALIDATION_ERROR", "TOTP is not enabled on this account.");
    }
    const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
    await db("users")
      .where({ id: userId })
      .update({ totp_recovery_code_hashes: recoveryCodes.map(hashRecoveryCode), updated_at: new Date() });
    return { recoveryCodes };
  }

  /** Second step of login for totp_enabled accounts — code is a 6-digit TOTP or an unused recovery code. */
  async function loginTotp(userId: string, code: string, meta: RequestMeta): Promise<SessionLoginResult> {
    const user = await db("users").where({ id: userId }).first();
    if (!user || !user.totp_enabled || !user.totp_secret) {
      throw new AppError("UNAUTHORIZED", "Invalid or expired code.");
    }

    let matched = verifyTotpCode(decryptSecret(user.totp_secret), code);
    if (!matched) {
      const hashes: string[] = user.totp_recovery_code_hashes ?? [];
      const candidateHash = hashRecoveryCode(code);
      const index = hashes.indexOf(candidateHash);
      if (index >= 0) {
        matched = true;
        const remaining = [...hashes.slice(0, index), ...hashes.slice(index + 1)];
        await db("users")
          .where({ id: userId })
          .update({ totp_recovery_code_hashes: remaining, updated_at: new Date() });
      }
    }
    if (!matched) {
      throw new AppError("UNAUTHORIZED", "Invalid or expired code.");
    }

    if (user.status === "pending_approval") {
      throw new AppError("UNAUTHORIZED", "Your account is waiting for admin approval.");
    }
    if (user.status !== "active") {
      throw new AppError("UNAUTHORIZED", "This account has been disabled.");
    }

    const rawSessionToken = await issueSession(user.id, meta);
    return { status: "session", token: rawSessionToken, user: { id: user.id, email: user.email, role: user.role } };
  }

  // --- Step-up admin elevation (T-MEMORY-041, D-MEMORY-019) ---
  // Not a session, not a scope change on any existing credential -- a
  // fresh, live, single-use proof that a specific admin account authorized
  // exactly one upcoming admin-tier call. See D-MEMORY-019 for the full
  // rationale, including why this deliberately re-checks password + TOTP
  // together (full re-authentication) instead of trusting a pmem_session
  // cookie or the calling OAuth credential's own claims: the OAuth channel
  // that actually reaches this endpoint in the motivating scenario (an
  // agent relaying a code the human typed into chat) has no session cookie
  // to present, and gateway_clients.owner_user_id is only populated for
  // the migrated static token today (T-MEMORY-029's
  // ensureStaticTokenCredential), not for OAuth connector credentials --
  // so there is no existing "which admin owns this OAuth client" link to
  // lean on. Re-proving identity from scratch (email + password + TOTP)
  // sidesteps that gap entirely and is at least as strong as a session
  // would have been.

  async function requestElevation(
    email: string,
    password: string,
    code: string,
    meta: RequestMeta
  ): Promise<ElevationGrant> {
    const normalized = normalizeEmail(email);
    const user = await db("users").where({ email: normalized }).first();
    if (!user || !user.password_hash) {
      // Same timing-parity trick as login(): run the same-cost hash even
      // when there's no user/password to compare against.
      await hashPassword(password);
      throw new AppError("UNAUTHORIZED", "Invalid email or password.");
    }
    const validPassword = await verifyPassword(password, user.password_hash);
    if (!validPassword) {
      throw new AppError("UNAUTHORIZED", "Invalid email or password.");
    }
    if (user.status === "pending_approval") {
      throw new AppError("UNAUTHORIZED", "Your account is waiting for admin approval.");
    }
    if (user.status !== "active") {
      throw new AppError("UNAUTHORIZED", "This account has been disabled.");
    }
    if (user.role !== "admin") {
      // Not a secret worth hiding behind the generic "Invalid email or
      // password" message -- this is the account owner asking about their
      // own role, not an attacker probing for account existence.
      throw new AppError("UNAUTHORIZED", "Elevation is only available to admin accounts.");
    }
    if (!user.totp_enabled || !user.totp_secret) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Enable 2FA on this admin account before requesting elevation."
      );
    }
    const secretBase32 = decryptSecret(user.totp_secret);
    if (!verifyTotpCode(secretBase32, code)) {
      throw new AppError("UNAUTHORIZED", "Invalid verification code.");
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ELEVATION_TTL_MS);
    const rawToken = newOpaqueToken();
    await db("admin_elevations").insert({
      id: randomUUID(),
      user_id: user.id,
      token_hash: hashToken(rawToken),
      created_at: now,
      expires_at: expiresAt,
      used_at: null,
      user_agent: meta.userAgent ?? null,
      ip: meta.ip ?? null
    });
    return { token: rawToken, expiresAt };
  }

  /**
   * Redeems an elevation grant: valid, unexpired, and not already used.
   * One atomic UPDATE ... WHERE used_at IS NULL AND expires_at > now
   * RETURNING is the single-use enforcement -- two concurrent redemption
   * attempts for the same token can't both win, no separate read-then-write
   * race window.
   */
  async function consumeElevation(rawToken: string): Promise<{ ok: true; userId: string } | { ok: false }> {
    const now = new Date();
    const rows = await db("admin_elevations")
      .where({ token_hash: hashToken(rawToken) })
      .whereNull("used_at")
      .andWhere("expires_at", ">", now)
      .update({ used_at: now })
      .returning(["user_id"]);
    if (!rows.length) {
      return { ok: false };
    }
    return { ok: true, userId: rows[0].user_id as string };
  }

  async function requirePasswordMatch(userId: string, currentPassword: string): Promise<Record<string, unknown>> {
    const user = await db("users").where({ id: userId }).first();
    if (!user || !user.password_hash || !(await verifyPassword(currentPassword, user.password_hash))) {
      throw new AppError("UNAUTHORIZED", "Invalid password.");
    }
    return user;
  }

  async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    await requirePasswordMatch(userId, currentPassword);
    if (newPassword.length < 8) {
      throw new AppError("VALIDATION_ERROR", "Password must be at least 8 characters.");
    }
    await db("users")
      .where({ id: userId })
      .update({ password_hash: await hashPassword(newPassword), updated_at: new Date() });
  }

  // --- Open self-registration + admin approval (T-MEMORY-038, D-MEMORY-016) ---
  // Parallel to, not a replacement for, invite→claim→verify-email above.

  async function register(
    email: string,
    password: string
  ): Promise<{ token: string; otpauthUrl: string; secretBase32: string }> {
    if (password.length < 8) {
      throw new AppError("VALIDATION_ERROR", "Password must be at least 8 characters.");
    }
    const normalized = normalizeEmail(email);
    const now = new Date();

    // Lazy cleanup: no cron needed, an expired pending registration for this
    // email is simply swept out of the way the next time someone tries to
    // register with it.
    await db("pending_registrations").where({ email: normalized }).andWhere("expires_at", "<", now).del();

    const existingUser = await db("users").where({ email: normalized }).first();
    if (existingUser) {
      throw new AppError("VALIDATION_ERROR", `A user with email ${normalized} already exists.`);
    }
    const existingPending = await db("pending_registrations").where({ email: normalized }).first();
    if (existingPending) {
      throw new AppError("VALIDATION_ERROR", `A user with email ${normalized} already exists.`);
    }

    const passwordHash = await hashPassword(password);
    const secretBase32 = base32Encode(generateTotpSecret());
    const rawToken = newOpaqueToken();
    await db("pending_registrations").insert({
      id: randomUUID(),
      email: normalized,
      password_hash: passwordHash,
      totp_secret_enc: encryptSecret(secretBase32),
      token_hash: hashToken(rawToken),
      created_at: now,
      expires_at: new Date(now.getTime() + PENDING_REGISTRATION_TTL_MS)
    });

    return { token: rawToken, otpauthUrl: buildOtpauthUrl(secretBase32, normalized), secretBase32 };
  }

  async function registerConfirm(rawToken: string, code: string): Promise<{ email: string; recoveryCodes: string[] }> {
    const now = new Date();
    const row = await db("pending_registrations").where({ token_hash: hashToken(rawToken) }).first();
    if (!row || new Date(row.expires_at) < now) {
      throw new AppError("VALIDATION_ERROR", "This link is invalid or has expired.");
    }
    const secretBase32 = decryptSecret(row.totp_secret_enc);
    if (!verifyTotpCode(secretBase32, code)) {
      throw new AppError("UNAUTHORIZED", "Invalid verification code.");
    }

    const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
    const userId = randomUUID();
    await db.transaction(async (trx) => {
      const alreadyExists = await trx("users").where({ email: row.email }).first();
      if (alreadyExists) {
        throw new AppError("VALIDATION_ERROR", `A user with email ${row.email} already exists.`);
      }
      await trx("users").insert({
        id: userId,
        email: row.email,
        password_hash: row.password_hash,
        email_verified_at: null,
        totp_secret: row.totp_secret_enc,
        totp_enabled: true,
        totp_recovery_code_hashes: recoveryCodes.map(hashRecoveryCode),
        role: "member",
        status: "pending_approval",
        created_at: now,
        updated_at: now
      });
      await trx("pending_registrations").where({ id: row.id }).del();
    });

    return { email: row.email as string, recoveryCodes };
  }

  async function listPendingApprovals(): Promise<{ id: string; email: string; createdAt: Date }[]> {
    return db("users")
      .where({ status: "pending_approval" })
      .orderBy("created_at")
      .select("id", "email", "created_at as createdAt");
  }

  async function approveUser(userId: string): Promise<void> {
    const updated = await db("users").where({ id: userId }).update({ status: "active", updated_at: new Date() });
    if (!updated) {
      throw new AppError("NOT_FOUND", "User not found.");
    }
  }

  async function rejectUser(userId: string): Promise<void> {
    const updated = await db("users").where({ id: userId }).update({ status: "disabled", updated_at: new Date() });
    if (!updated) {
      throw new AppError("NOT_FOUND", "User not found.");
    }
  }

  // Full account roster for the admin Users screen -- deliberately excludes
  // status="pending_approval" rows, which have their own dedicated Approvals
  // screen/flow (listPendingApprovals above) rather than living here too.
  async function listUsers(): Promise<
    { id: string; email: string; role: string; status: string; totpEnabled: boolean; createdAt: Date }[]
  > {
    return db("users")
      .whereIn("status", ["active", "disabled"])
      .orderBy("created_at")
      .select("id", "email", "role", "status", "totp_enabled as totpEnabled", "created_at as createdAt");
  }

  // Refuses to let an admin change their own role/status through this
  // endpoint (self-lockout is a one-way door on a self-hosted, single-owner
  // instance -- ask another admin instead) and refuses to demote or disable
  // the last remaining admin, for the same reason.
  async function assertNotSelfOrLastAdmin(actingUserId: string, targetUserId: string, targetRole: string): Promise<void> {
    if (actingUserId === targetUserId) {
      throw new AppError("VALIDATION_ERROR", "You cannot change your own role or status here — ask another admin.");
    }
    if (targetRole === "admin") {
      const otherAdmins = await db("users")
        .where({ role: "admin", status: "active" })
        .whereNot({ id: targetUserId })
        .first();
      if (!otherAdmins) {
        throw new AppError("VALIDATION_ERROR", "This is the last active admin — promote another admin first.");
      }
    }
  }

  async function setUserRole(actingUserId: string, targetUserId: string, role: "admin" | "member"): Promise<void> {
    const target = await db("users").where({ id: targetUserId }).first();
    if (!target) {
      throw new AppError("NOT_FOUND", "User not found.");
    }
    if (role !== target.role) {
      await assertNotSelfOrLastAdmin(actingUserId, targetUserId, target.role);
    }
    await db("users").where({ id: targetUserId }).update({ role, updated_at: new Date() });
  }

  async function setUserStatus(actingUserId: string, targetUserId: string, status: "active" | "disabled"): Promise<void> {
    const target = await db("users").where({ id: targetUserId }).first();
    if (!target) {
      throw new AppError("NOT_FOUND", "User not found.");
    }
    if (status !== target.status) {
      await assertNotSelfOrLastAdmin(actingUserId, targetUserId, target.role);
    }
    await db("users").where({ id: targetUserId }).update({ status, updated_at: new Date() });
  }

  // "Bootstrapped" means a usable admin exists — role=admin AND a password
  // actually set. A CLI-created (`pm3m admin create`) admin row with
  // password_hash still null does NOT count: that account can't log in yet,
  // so the UI must keep offering setup, not a login form that can never
  // succeed.
  async function claimedAdminExists(queryable: Knex | Knex.Transaction = db): Promise<boolean> {
    const admin = await queryable("users").where({ role: "admin" }).whereNotNull("password_hash").first();
    return Boolean(admin);
  }

  async function bootstrapStatus(): Promise<{ adminExists: boolean }> {
    return { adminExists: await claimedAdminExists() };
  }

  /**
   * First-run-only self-registration: while no usable (password-set) admin
   * exists anywhere in the database, the first visitor to submit this form
   * becomes the admin and is logged in immediately. This is the "first
   * visitor becomes admin" pattern D-MEMORY-008 originally rejected for an
   * already-public instance — see D-MEMORY-013 for why it was reinstated
   * (deliberate maintainer choice, accepted tradeoff for solo/personal
   * self-host installs where the deploy-to-first-visit window is the
   * operator's own browser tab). Once a usable admin exists, this
   * permanently 400s.
   *
   * If the submitted email matches an existing admin row that was created
   * via `pm3m admin create` but never claimed (password_hash still null),
   * this claims that row instead of trying to insert a duplicate — the CLI
   * bootstrap and the browser bootstrap screen are two doors into the same
   * one-time setup, not two competing accounts.
   */
  async function bootstrapFirstAdmin(email: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    if (password.length < 8) {
      throw new AppError("VALIDATION_ERROR", "Password must be at least 8 characters.");
    }
    const normalized = normalizeEmail(email);
    const userId = await db.transaction(async (trx) => {
      if (await claimedAdminExists(trx)) {
        throw new AppError("VALIDATION_ERROR", "An admin already exists. Ask them for an invite.");
      }
      const now = new Date();
      const existingByEmail = await trx("users").where({ email: normalized }).first();

      if (existingByEmail) {
        if (existingByEmail.role !== "admin" || existingByEmail.password_hash) {
          throw new AppError("VALIDATION_ERROR", `A user with email ${normalized} already exists.`);
        }
        await trx("users")
          .where({ id: existingByEmail.id })
          .update({
            password_hash: await hashPassword(password),
            email_verified_at: existingByEmail.email_verified_at ?? now,
            status: "active",
            updated_at: now
          });
        return existingByEmail.id as string;
      }

      const id = randomUUID();
      await trx("users").insert({
        id,
        email: normalized,
        password_hash: await hashPassword(password),
        email_verified_at: now,
        totp_enabled: false,
        role: "admin",
        status: "active",
        created_at: now,
        updated_at: now
      });
      return id;
    });
    const rawSessionToken = await issueSession(userId, meta);
    return { status: "session", token: rawSessionToken, user: { id: userId, email: normalized, role: "admin" } };
  }

  async function logout(rawToken: string): Promise<void> {
    await db("sessions").where({ token_hash: hashToken(rawToken) }).update({ revoked_at: new Date() });
  }

  async function identifyFromRequest(request: IncomingMessage): Promise<SessionIdentity | null> {
    const rawToken = parseCookies(request)[SESSION_COOKIE_NAME];
    if (!rawToken) {
      return null;
    }
    const now = new Date();
    const row = await db("sessions")
      .join("users", "users.id", "sessions.user_id")
      .where("sessions.token_hash", hashToken(rawToken))
      .whereNull("sessions.revoked_at")
      .andWhere("sessions.expires_at", ">", now)
      .andWhere("users.status", "active")
      .select(
        "sessions.id as sessionId",
        "users.id as userId",
        "users.email as email",
        "users.role as role",
        "users.status as status",
        "users.totp_enabled as totpEnabled"
      )
      .first();
    if (!row) {
      return null;
    }
    db("sessions")
      .where({ id: row.sessionId })
      .update({ last_seen_at: now })
      .catch(() => {
        // Best-effort activity timestamp; a failed update must not fail the request.
      });
    return {
      sessionId: row.sessionId,
      userId: row.userId,
      email: row.email,
      role: row.role,
      status: row.status,
      totpEnabled: row.totpEnabled
    };
  }

  // --- Personal API tokens (T-MEMORY-047) ---
  // A third bearer-auth source, alongside the shared static MCP_TOKEN and
  // OAuth connector tokens (see docs/AUTH.md "Personal API tokens"), scoped
  // to exactly one user. Hash-only storage (token_hash), same "never store
  // the raw secret" convention as sessions/tokens/admin_elevations -- this
  // token is only ever verified, never redisplayed, so there's nothing to
  // decrypt and therefore no separate encryption key to manage for it.
  // Management (status check, regenerate) is session-only, same "a raw
  // secret only ever enters/leaves the system through the trusted browser
  // profile UI" convention as password/2FA/git-credential management --
  // there is deliberately no MCP tool or GraphQL mutation for this, only
  // the /auth/profile/personal-token* REST routes below.

  async function personalTokenStatus(userId: string): Promise<{
    exists: boolean;
    tokenHint: string | null;
    createdAt: string | null;
    lastUsedAt: string | null;
  }> {
    const row = await db("personal_tokens").where({ owner_user_id: userId }).first();
    if (!row) {
      return { exists: false, tokenHint: null, createdAt: null, lastUsedAt: null };
    }
    return {
      exists: true,
      tokenHint: row.token_hint as string,
      createdAt: new Date(row.created_at as string).toISOString(),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string).toISOString() : null
    };
  }

  /**
   * Always issues a fresh token, replacing any existing one for this user in
   * the same transaction ("replace, don't mutate, a secret row" -- same
   * convention as recovery codes and git credentials). Serves both first-time
   * generation (no existing row) and explicit regenerate (existing row
   * invalidated atomically) through one call, so the frontend's "Generate"
   * and "Regenerate" buttons can hit the same endpoint. The raw token is
   * returned exactly once, at the moment of this call -- shown-once, same
   * principle as recovery codes / the TOTP secret, per this task's resolved
   * design question (consistency with that existing pattern, chosen over a
   * persistently-visible token).
   */
  async function regeneratePersonalToken(
    userId: string
  ): Promise<{ token: string; tokenHint: string; createdAt: Date }> {
    const now = new Date();
    const rawToken = newOpaqueToken();
    const tokenHint = rawToken.slice(-4);
    await db.transaction(async (trx) => {
      await trx("personal_tokens").where({ owner_user_id: userId }).del();
      await trx("personal_tokens").insert({
        id: randomUUID(),
        owner_user_id: userId,
        token_hash: hashToken(rawToken),
        token_hint: tokenHint,
        created_at: now,
        last_used_at: null
      });
    });
    return { token: rawToken, tokenHint, createdAt: now };
  }

  // --- Per-connector OAuth credentials (replaces the old static, shared
  // PROJECT_MEMORY_OAUTH_CLIENT_ID/_SECRET pair, and then replaced the
  // one-per-user model that followed it) ---
  // A user may hold many oauth_clients rows now, one per named connector
  // (e.g. "Claude.ai", "ChatGPT") -- owner_user_id is no longer UNIQUE, only
  // client_id is (still looked up directly by value at /oauth/authorize and
  // /oauth/token). This is the fix for two real problems live testing
  // surfaced under the one-per-user model: (1) regenerating a credential for
  // a new connector used to invalidate every other connector's
  // already-working credential, since there was only ever one row per user;
  // (2) each connector's expected redirect_uri is now captured and stored
  // on its own row at creation time (see validateAuthorizeParams, oauth.ts),
  // instead of requiring an admin to hand-edit the deployment-wide
  // PROJECT_MEMORY_ALLOWED_REDIRECT_URIS env var for every new one-off
  // ChatGPT/Codex connector callback URL.
  //
  // Otherwise this still mirrors personal_tokens: hash-only secret storage,
  // a plaintext last-4 hint for UI recognition, session-only management (no
  // MCP tool or GraphQL mutation -- only the /auth/profile/oauth-clients*
  // REST routes below). client_id is still NOT secret -- it identifies
  // "this is a registered pmem connector app", the actual access boundary is
  // still the real per-user login /oauth/authorize requires (D-MEMORY-027)
  // -- so listOAuthClients returns it in full (persistently displayable),
  // unlike clientSecretHint.

  type OAuthClientRow = {
    id: string;
    label: string | null;
    clientId: string;
    clientSecretHint: string;
    redirectUri: string | null;
    createdAt: string;
    lastUsedAt: string | null;
  };

  function toOAuthClientRow(row: Record<string, unknown>): OAuthClientRow {
    return {
      id: row.id as string,
      label: (row.label as string | null) ?? null,
      clientId: row.client_id as string,
      clientSecretHint: row.client_secret_hint as string,
      redirectUri: (row.redirect_uri as string | null) ?? null,
      createdAt: new Date(row.created_at as string).toISOString(),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string).toISOString() : null
    };
  }

  async function listOAuthClients(userId: string): Promise<OAuthClientRow[]> {
    const rows = await db("oauth_clients").where({ owner_user_id: userId }).orderBy("created_at", "desc");
    return rows.map(toOAuthClientRow);
  }

  /**
   * Always inserts a brand-new row -- unlike the old regenerateOAuthClient,
   * this never deletes any of the user's other credentials, which is the
   * actual fix for problem (1) above: creating a credential for a new
   * connector can no longer knock out an unrelated, already-working one.
   * The raw client_secret is returned exactly once, at the moment of this
   * call (shown-once), same as personal tokens.
   */
  async function createOAuthClient(
    userId: string,
    label: string,
    redirectUri: string
  ): Promise<{ id: string; clientId: string; clientSecret: string; redirectUri: string; createdAt: Date }> {
    const now = new Date();
    const id = randomUUID();
    const clientId = newOpaqueToken();
    const clientSecret = newOpaqueToken();
    const clientSecretHint = clientSecret.slice(-4);
    await db("oauth_clients").insert({
      id,
      owner_user_id: userId,
      client_id: clientId,
      client_secret_hash: hashToken(clientSecret),
      client_secret_hint: clientSecretHint,
      label,
      redirect_uri: redirectUri,
      created_at: now,
      last_used_at: null
    });
    return { id, clientId, clientSecret, redirectUri, createdAt: now };
  }

  // Ownership-checked lookup shared by regenerateOAuthClient/deleteOAuthClient
  // below -- same "don't distinguish a row that isn't yours from a row that
  // doesn't exist" convention as assertProjectMember (projects-core.mixin.ts)
  // and every other owner-scoped lookup in this codebase.
  async function requireOwnedOAuthClient(userId: string, id: string): Promise<Record<string, unknown>> {
    const row = await db("oauth_clients").where({ id }).first();
    if (!row || row.owner_user_id !== userId) {
      throw new AppError("NOT_FOUND", "OAuth client credential not found.");
    }
    return row;
  }

  /**
   * Rotates client_id + client_secret in place on one specific credential
   * row, leaving its label/redirect_uri and every other credential for this
   * user untouched -- issues a brand-new client_id too, not just a new
   * secret, so a leaked/rotated credential can't be reused even by guessing
   * the old client_id. The raw client_secret is returned exactly once, at
   * the moment of this call (shown-once); client_id is not secret and
   * remains readable afterward via listOAuthClients.
   */
  async function regenerateOAuthClient(
    userId: string,
    id: string
  ): Promise<{ id: string; clientId: string; clientSecret: string; redirectUri: string | null; createdAt: Date }> {
    const existing = await requireOwnedOAuthClient(userId, id);
    const now = new Date();
    const clientId = newOpaqueToken();
    const clientSecret = newOpaqueToken();
    const clientSecretHint = clientSecret.slice(-4);
    await db("oauth_clients")
      .where({ id })
      .update({
        client_id: clientId,
        client_secret_hash: hashToken(clientSecret),
        client_secret_hint: clientSecretHint,
        last_used_at: null
      });
    return {
      id,
      clientId,
      clientSecret,
      redirectUri: (existing.redirect_uri as string | null) ?? null,
      createdAt: now
    };
  }

  async function deleteOAuthClient(userId: string, id: string): Promise<void> {
    await requireOwnedOAuthClient(userId, id);
    await db("oauth_clients").where({ id }).del();
  }

  /**
   * Resolves a personal-token bearer (`Authorization: Bearer <token>`) to the
   * owning user's identity -- same SessionIdentity shape identifyFromRequest
   * returns for a session cookie, so http-server.ts's scope-tier resolution
   * (admin role -> admin scope, member role -> write scope) treats the two
   * sources identically, per this task's acceptance criteria. Only an
   * `active` user's token resolves -- a disabled/pending user's old token
   * (if any) stops working the moment their account does, no separate
   * revocation step needed. `last_used_at` is stamped best-effort, same
   * fire-and-forget pattern as sessions.last_seen_at below.
   */
  async function identifyPersonalToken(request: IncomingMessage): Promise<SessionIdentity | null> {
    const rawToken = bearerToken(request);
    if (!rawToken) {
      return null;
    }
    const row = await db("personal_tokens")
      .join("users", "users.id", "personal_tokens.owner_user_id")
      .where("personal_tokens.token_hash", hashToken(rawToken))
      .andWhere("users.status", "active")
      .select(
        "personal_tokens.id as tokenRowId",
        "users.id as userId",
        "users.email as email",
        "users.role as role",
        "users.status as status",
        "users.totp_enabled as totpEnabled"
      )
      .first();
    if (!row) {
      return null;
    }
    db("personal_tokens")
      .where({ id: row.tokenRowId })
      .update({ last_used_at: new Date() })
      .catch(() => {
        // Best-effort activity timestamp; a failed update must not fail the request.
      });
    return {
      // Reuses SessionIdentity's `sessionId` slot to carry the personal_tokens
      // row id -- not consumed outside this module (see identifyFromRequest's
      // own use of it above), so no interface change needed for this second
      // credential-row-id source.
      sessionId: row.tokenRowId,
      userId: row.userId,
      email: row.email,
      role: row.role,
      status: row.status,
      totpEnabled: row.totpEnabled
    };
  }

  // --- Notifications unread state (T-MEMORY-051) ---
  // Server-side, per-account, same "survives across devices" convention as
  // personal_tokens/totp_enabled above (a session-cookie or browser-local
  // flag would not survive a device switch). `notifications_seen_at` is
  // `null` until the user's first visit to the notifications page, so every
  // existing event counts as unread on that first visit -- no backfill.
  // Session-only, same "/auth/profile/*" REST convention as the rest of
  // this profile surface -- no GraphQL mutation for this.

  async function notificationsSeenAt(userId: string): Promise<{ seenAt: string | null }> {
    const row = await db("users").where({ id: userId }).select("notifications_seen_at").first();
    return { seenAt: row?.notifications_seen_at ? new Date(row.notifications_seen_at as string).toISOString() : null };
  }

  async function markNotificationsSeen(userId: string): Promise<{ seenAt: string | null }> {
    const now = new Date();
    await db("users").where({ id: userId }).update({ notifications_seen_at: now });
    return { seenAt: now.toISOString() };
  }

  // --- OAuth SSO identity resolution (real per-user login for OAuth
  // connectors, replacing the old shared-magic-token gate) ---
  // Resolves an OAuth access token's `sub` claim (a users.id, frozen onto
  // the authorization code at authorize time -- see oauth.ts's
  // OAuthCodeRecord.ownerUserId / authorizeWithSession) to that user's
  // CURRENT role, fresh on every call so a role change or account disable
  // takes effect immediately -- never cached in the token itself. Only an
  // `active` user resolves, same convention as identifyPersonalToken above.
  // Returns null for a sub that doesn't match any active user, which
  // includes: a disabled/deleted account, and a still-valid pre-migration
  // token whose sub was the old hardcoded "project-memory-user" literal
  // (never a real users.id) -- both cases are handled identically by the
  // caller (http-server.ts's isAuthorizedForScopes), which fails closed
  // (401) rather than silently downgrading to write scope.
  async function identifyOAuthOwner(userId: string): Promise<{ userId: string; role: string } | null> {
    if (!userId) {
      return null;
    }
    const row = await db("users").where({ id: userId }).andWhere("status", "active").select("id", "role").first();
    if (!row) {
      return null;
    }
    return { userId: row.id as string, role: row.role as string };
  }

  async function activeToken(rawToken: string, allowedPurposes: string[]): Promise<Record<string, unknown>> {
    const now = new Date();
    const row = await db("tokens").where({ token_hash: hashToken(rawToken) }).first();
    if (!row || row.used_at || new Date(row.expires_at) < now) {
      throw new AppError("VALIDATION_ERROR", "This link is invalid or has expired.");
    }
    if (!allowedPurposes.includes(row.purpose)) {
      throw new AppError("VALIDATION_ERROR", "This link cannot be used here.");
    }
    return row;
  }

  return {
    invite,
    claimContext,
    claim,
    verifyEmail,
    login,
    logout,
    identifyFromRequest,
    bootstrapStatus,
    bootstrapFirstAdmin,
    enrollTotp,
    confirmTotp,
    disableTotp,
    regenerateRecoveryCodes,
    loginTotp,
    changePassword,
    register,
    registerConfirm,
    listPendingApprovals,
    approveUser,
    rejectUser,
    listUsers,
    setUserRole,
    setUserStatus,
    requestElevation,
    consumeElevation,
    personalTokenStatus,
    regeneratePersonalToken,
    listOAuthClients,
    createOAuthClient,
    regenerateOAuthClient,
    deleteOAuthClient,
    identifyPersonalToken,
    notificationsSeenAt,
    markNotificationsSeen,
    identifyOAuthOwner
  };
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (secure) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

export function clearSessionCookieHeader(secure: boolean): string {
  const attrs = [`${SESSION_COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

export function getSessionToken(request: IncomingMessage): string | undefined {
  return parseCookies(request)[SESSION_COOKIE_NAME];
}

/** Extracts the raw token from an `Authorization: Bearer <token>` header, or undefined if absent/malformed. */
function bearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (!header) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : undefined;
}

export function isForwardedHttps(request: IncomingMessage): boolean {
  const proto = request.headers["x-forwarded-proto"];
  const value = Array.isArray(proto) ? proto[0] : proto;
  return value?.split(",")[0]?.trim().toLowerCase() === "https";
}

function parseCookies(request: IncomingMessage): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Exported for tests/smoke scripts that need to seed a user directly. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const derived = await scrypt(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function newOpaqueToken(): string {
  return base64url(randomBytes(32));
}

/** Exported for oauth.ts's per-user OAuth client credential verification (same sha256-hex-hash convention as personal_tokens/sessions/tokens above). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
