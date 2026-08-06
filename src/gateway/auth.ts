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

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

export const SESSION_COOKIE_NAME = "pmem_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;

export type AuthFacade = ReturnType<typeof createAuthFacade>;

export interface SessionIdentity {
  sessionId: string;
  userId: string;
  email: string;
  role: string;
}

interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

type LoginResult =
  | { status: "session"; token: string; user: { id: string; email: string; role: string } }
  | { status: "pending_totp"; userId: string };

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
    if (user.status !== "active") {
      throw new AppError("UNAUTHORIZED", "This account has been disabled.");
    }
    if (!user.email_verified_at) {
      throw new AppError("UNAUTHORIZED", "Please verify your email before logging in.");
    }
    if (user.totp_enabled) {
      // No code path sets totp_enabled=true yet (that's the 2FA task) so this
      // is currently unreachable, but the response shape is fixed here so the
      // 2FA task only has to add the second step, not touch this contract.
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
        "users.role as role"
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
    return { sessionId: row.sessionId, userId: row.userId, email: row.email, role: row.role };
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
    bootstrapFirstAdmin
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

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
