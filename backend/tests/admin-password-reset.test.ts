import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthFacade, hashPassword, hashToken, type AuthFacade } from "../src/gateway/auth.js";
import { startGatewayServer, type StartedGatewayServer } from "../src/gateway/http-server.js";
import type { PgToolService } from "../src/gateway/pg-tool-service.js";

let db: Knex;
let auth: AuthFacade;
let server: StartedGatewayServer | undefined;
let oldHash: string;
const oldPassword = "old-password-123";
const newPassword = "new-password-456";
const audit = vi.fn().mockResolvedValue(undefined);
const postgresUrl = process.env.MARROW_TEST_POSTGRES_URL;
let schema: string;

beforeEach(async () => {
  vi.stubEnv("TOTP_ENC_KEY", Buffer.alloc(32, 1).toString("base64"));
  vi.stubEnv("GRAPHQL_CORS_ORIGIN", "");
  audit.mockClear();
  schema = `reset_test_${randomUUID().replaceAll("-", "")}`;
  db = postgresUrl
    ? knex({ client: "pg", connection: postgresUrl, searchPath: [schema] })
    : knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  if (postgresUrl) await db.raw('CREATE SCHEMA ??', [schema]);
  await db.schema.createTable("users", t => {
    t.text("id").primary(); t.text("email").unique(); t.text("role"); t.text("status"); t.text("password_hash");
    t.text("totp_secret"); t.boolean("totp_enabled"); t.text("totp_recovery_code_hashes"); t.text("invited_by");
    t.timestamp("email_verified_at"); t.timestamp("created_at"); t.timestamp("updated_at");
  });
  await db.schema.createTable("tokens", t => {
    for (const key of ["id", "user_id", "email", "purpose", "token_hash", "created_by"]) t.text(key);
    t.timestamp("created_at"); t.timestamp("expires_at"); t.timestamp("used_at");
  });
  await db.schema.createTable("sessions", t => {
    for (const key of ["id", "user_id", "token_hash", "user_agent", "ip"]) t.text(key);
    for (const key of ["created_at", "expires_at", "last_seen_at", "revoked_at"]) t.timestamp(key);
  });
  await db.schema.createTable("personal_tokens", t => { t.text("id"); t.text("owner_user_id"); t.text("token_hash"); t.timestamp("last_used_at"); });
  await db.schema.createTable("system_settings", t => { t.text("key"); t.boolean("value"); });
  await db("system_settings").insert({ key: "credits_enabled", value: false });
  oldHash = await hashPassword(oldPassword);
  await db("users").insert(["admin", "target", "other"].map(id => ({
    id, email: `${id}@example.test`, role: id === "admin" ? "admin" : "member", status: "active",
    password_hash: oldHash, email_verified_at: new Date(), totp_enabled: id === "target",
    totp_secret: "unchanged-secret", totp_recovery_code_hashes: "unchanged-recovery-codes", created_at: new Date()
  })));
  await db("sessions").insert(["admin", "target", "other"].map(id => ({
    id: `${id}-session`, user_id: id, token_hash: hashToken(`${id}-cookie`), expires_at: new Date(Date.now() + 86_400_000)
  })));
  auth = createAuthFacade(db);
});

afterEach(async () => {
  server?.server.closeAllConnections(); await server?.stop(); server = undefined;
  if (postgresUrl) await db.raw('DROP SCHEMA ?? CASCADE', [schema]);
  await db.destroy(); vi.unstubAllEnvs();
});

describe("admin-issued password reset links", () => {
  it("stores only a hash, expires in 24 hours and leaves credentials untouched until claim", async () => {
    const result = await auth.createPasswordReset("admin", "target");
    expect(result.email).toBe("target@example.test");
    expect(result.expiresAt.getTime() - Date.now()).toBeGreaterThan(86_390_000);
    expect(result.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(86_400_000);
    expect(await db("tokens").first()).toMatchObject({ token_hash: hashToken(result.token), created_by: "admin", purpose: "password_reset" });
    expect(JSON.stringify(await db("tokens"))).not.toContain(result.token);
    expect(await db("users").where({ id: "target" }).first()).toMatchObject({
      password_hash: oldHash, totp_enabled: postgresUrl ? true : 1,
      totp_secret: "unchanged-secret", totp_recovery_code_hashes: "unchanged-recovery-codes"
    });
    expect(await db("sessions").whereNotNull("revoked_at")).toHaveLength(0);
    expect(await auth.claimContext(result.token)).toEqual({ email: result.email, purpose: "password_reset" });
  });

  it("replaces older links for the same user without invalidating other token purposes", async () => {
    const first = await auth.createPasswordReset("admin", "target");
    await db("tokens").insert({ id: "verify", user_id: "target", purpose: "verify_email", token_hash: hashToken("verify") });
    const second = await auth.createPasswordReset("admin", "target");
    await expect(auth.claim(first.token, newPassword)).rejects.toThrow("invalid or has expired");
    expect(await auth.claimContext(second.token)).toMatchObject({ purpose: "password_reset" });
    expect(await db("tokens").where({ id: "verify" }).first()).toMatchObject({ used_at: null });
  });

  it("resets password and both 2FA credentials once, rejects old challenges and retains account settings", async () => {
    const pendingLogin = await auth.login("target@example.test", oldPassword, {});
    if (pendingLogin.status !== "pending_totp") throw new Error("Expected 2FA before reset");
    const link = await auth.createPasswordReset("admin", "target");
    await expect(auth.claim(link.token, "short")).rejects.toThrow("at least 8");
    expect(await auth.claim(link.token, newPassword)).toMatchObject({ userId: "target", emailVerified: true });
    await expect(auth.claim(link.token, "another-password")).rejects.toThrow("invalid or has expired");
    await expect(auth.login("target@example.test", oldPassword, {})).rejects.toThrow("Invalid email or password");
    await expect(auth.loginTotp("target", "123456", {}, pendingLogin.challenge)).rejects.toThrow("Invalid or expired code");
    await expect(auth.loginTotp("target", "old-recovery-code", {}, pendingLogin.challenge)).rejects.toThrow("Invalid or expired code");
    expect(await auth.login("target@example.test", newPassword, {})).toMatchObject({ status: "session", user: { id: "target" } });
    expect(await db("users").where({ id: "target" }).first()).toMatchObject({
      status: "active", role: "member", totp_enabled: postgresUrl ? false : 0, totp_secret: null, totp_recovery_code_hashes: null
    });
    expect(await db("sessions").whereNotNull("revoked_at").pluck("user_id")).toEqual(["target"]);
    expect(await db("users").where({ id: "admin" }).first()).toMatchObject({ password_hash: oldHash, totp_secret: "unchanged-secret" });
  });

  it.each([true, false])("creates a local password for a provider-only account and clears enrolled/pending TOTP (enabled=%s)", async enabled => {
    await db("users").where({ id: "target" }).update({ password_hash: null, email_verified_at: null, totp_enabled: enabled });
    const link = await auth.createPasswordReset("admin", "target");
    const result = await auth.claim(link.token, newPassword);
    expect(result).toMatchObject({ emailVerified: false, verifyToken: expect.any(String) });
    expect(await db("users").where({ id: "target" }).first()).toMatchObject({
      totp_enabled: postgresUrl ? false : 0, totp_secret: null, totp_recovery_code_hashes: null
    });
    // ClaimPage completes this existing same-browser verification step.
    await auth.verifyEmail(result.verifyToken!);
    expect(await auth.login(result.email, newPassword, {})).toMatchObject({ status: "session" });
  });

  it("retains 2FA when an authenticated user changes their password in Profile", async () => {
    await auth.changePassword("target", oldPassword, newPassword, "target-session");
    expect(await db("users").where({ id: "target" }).first()).toMatchObject({
      totp_enabled: postgresUrl ? true : 1, totp_secret: "unchanged-secret", totp_recovery_code_hashes: "unchanged-recovery-codes"
    });
    expect(await auth.login("target@example.test", newPassword, {})).toMatchObject({ status: "pending_totp" });
  });

  it("allows only one of two concurrent claims to change the password", async () => {
    const { token } = await auth.createPasswordReset("admin", "target");
    const results = await Promise.allSettled([auth.claim(token, newPassword), auth.claim(token, "another-password")]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  });

  it("rolls back password, 2FA and token consumption if session revocation fails", async () => {
    const { token } = await auth.createPasswordReset("admin", "target");
    if (postgresUrl) {
      await db.raw("CREATE FUNCTION fail_revocation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'revocation failed'; END; $$");
      await db.raw("CREATE TRIGGER fail_revocation BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION fail_revocation()");
    } else {
      await db.raw("CREATE TRIGGER fail_revocation BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'revocation failed'); END");
    }
    await expect(auth.claim(token, newPassword)).rejects.toThrow("revocation failed");
    expect(await db("users").where({ id: "target" }).first()).toMatchObject({
      password_hash: oldHash, totp_enabled: postgresUrl ? true : 1,
      totp_secret: "unchanged-secret", totp_recovery_code_hashes: "unchanged-recovery-codes"
    });
    expect(await auth.claimContext(token)).toMatchObject({ purpose: "password_reset" });
    await db.raw(postgresUrl ? "DROP TRIGGER fail_revocation ON sessions" : "DROP TRIGGER fail_revocation");
    await expect(auth.claim(token, newPassword)).resolves.toMatchObject({ userId: "target" });
  });

  it("rejects expiry, unrelated token purposes and unknown tokens", async () => {
    const { token } = await auth.createPasswordReset("admin", "target");
    await db("tokens").update({ expires_at: new Date(1) });
    await expect(auth.claim(token, newPassword)).rejects.toThrow("invalid or has expired");
    await db("tokens").update({ expires_at: new Date(Date.now() + 60_000), purpose: "verify_email" });
    await expect(auth.claim(token, newPassword)).rejects.toThrow("cannot be used here");
    await expect(auth.claim("unknown", newPassword)).rejects.toThrow("invalid or has expired");
  });

  it("enforces admin authority, self-service boundary and active target accounts", async () => {
    await expect(auth.createPasswordReset("other", "target")).rejects.toThrow("active admin");
    await expect(auth.createPasswordReset("admin", "admin")).rejects.toThrow("profile");
    await expect(auth.createPasswordReset("admin", "missing")).rejects.toThrow("not found");
    for (const status of ["disabled", "pending_approval"]) {
      await db("users").where({ id: "target" }).update({ status });
      await expect(auth.createPasswordReset("admin", "target")).rejects.toThrow("active accounts");
    }
    expect(await db("tokens")).toHaveLength(0);
  });

  it("preserves the invite claim and verify-email flow", async () => {
    const invite = await auth.invite("new@example.test", "admin");
    const result = await auth.claim(invite.token, newPassword);
    expect(result).toMatchObject({ email: "new@example.test", emailVerified: false, verifyToken: expect.any(String) });
    await expect(auth.claim(invite.token, newPassword)).rejects.toThrow("invalid or has expired");
    await auth.verifyEmail(result.verifyToken!);
    expect(await auth.login(result.email, newPassword, {})).toMatchObject({ status: "session" });
  });
});

describe("password reset HTTP authorization", () => {
  async function start() {
    server = await startGatewayServer({ recordSystemEvent: audit } as unknown as PgToolService,
      { host: "127.0.0.1", port: 0, token: "static-admin-token", auth });
    return server.url;
  }

  it("requires an admin cookie and trusted Origin, never static or personal bearer alone", async () => {
    const base = await start();
    const path = `${base}/auth/admin/users/target/password-reset`;
    await db("personal_tokens").insert({ id: "pat", owner_user_id: "admin", token_hash: hashToken("admin-personal-token") });
    for (const headers of [{}, { authorization: "Bearer static-admin-token" }, { authorization: "Bearer admin-personal-token" }, { cookie: "marrow_session=other-cookie" }]) {
      expect((await fetch(path, { method: "POST", headers: { ...headers, origin: base } })).status).toBe(401);
    }
    for (const headers of [{}, { origin: "https://evil.example.test" }]) {
      expect((await fetch(path, { method: "POST", headers: { ...headers, cookie: "marrow_session=admin-cookie" } })).status).toBe(403);
    }
    expect(await db("tokens")).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
    const result = await fetch(path, { method: "POST", headers: { cookie: "marrow_session=admin-cookie", origin: base } });
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    const body = await result.json() as { data: { email: string; claimPath: string; expiresAt: string } };
    expect(body.data).toMatchObject({ email: "target@example.test", claimPath: expect.stringMatching(/^\/claim\?token=/), expiresAt: expect.any(String) });
    const token = new URL(body.data.claimPath, base).searchParams.get("token")!;
    expect(audit).toHaveBeenCalledWith("user.password_reset_requested", "Password reset link issued by admin", "target");
    expect(JSON.stringify(audit.mock.calls)).not.toContain(token);
    const claimed = await fetch(`${base}/auth/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password: newPassword }) });
    expect(claimed.status).toBe(200);
    expect((await fetch(`${base}/auth/me`, { headers: { cookie: "marrow_session=target-cookie" } })).status).toBe(401);
    expect((await fetch(`${base}/auth/me`, { headers: { cookie: "marrow_session=admin-cookie" } })).status).toBe(200);
  });

  it("rejects a disabled admin session and honours configured browser origins", async () => {
    const base = await start();
    const path = `${base}/auth/admin/users/target/password-reset`;
    const headers = { cookie: "marrow_session=admin-cookie", origin: "https://ui.example.test" };
    vi.stubEnv("GRAPHQL_CORS_ORIGIN", headers.origin);
    expect((await fetch(path, { method: "POST", headers })).status).toBe(200);
    await db("users").where({ id: "admin" }).update({ status: "disabled" });
    expect((await fetch(path, { method: "POST", headers })).status).toBe(401);
  });
});

it("seeds RU/EN reset labels and rolls the migration back without removing unrelated translations", async () => {
  await db.schema.createTable("translations", t => {
    for (const name of ["locale", "namespace", "key", "value", "updated_at"]) t.text(name);
    t.unique(["locale", "namespace", "key"]);
  });
  await db("translations").insert({ locale: "en", namespace: "users", key: "users", value: "Users" });
  const require = createRequire(import.meta.url);
  const migration = require("../migrations/pg/145_admin_password_reset_i18n.cjs") as { up(db: Knex): Promise<void>; down(db: Knex): Promise<void> };
  await migration.up(db);
  expect(await db("translations").where({ key: "resetPassword" }).pluck("locale")).toEqual(["en", "ru"]);
  const combined = require("../migrations/pg/146_password_reset_2fa_i18n.cjs") as typeof migration;
  await db("translations").insert([
    { locale: "en", namespace: "auth", key: "passwordResetNotice", value: "Your password has been reset. Sign in with your new password." },
    { locale: "ru", namespace: "auth", key: "passwordResetNotice", value: "Ваш пароль сброшен. Войдите с новым паролем." }
  ]);
  const beforeCombined = await db("translations").select("locale", "namespace", "key", "value").orderBy(["namespace", "key", "locale"]);
  await combined.up(db);
  expect(await db("translations").where({ key: "passwordReset2faWarning" }).pluck("locale")).toEqual(["en", "ru"]);
  expect((await db("translations").where({ locale: "en", namespace: "users", key: "resetLinkInstructions" }).first()).value).toContain("disables two-factor");
  expect((await db("translations").where({ locale: "ru", namespace: "users", key: "resetPasswordWarning" }).first()).value).toContain("двухфакторная");
  await combined.down(db);
  expect(await db("translations").select("locale", "namespace", "key", "value").orderBy(["namespace", "key", "locale"])).toEqual(beforeCombined);
  await migration.down(db);
  expect(await db("translations").where({ namespace: "users" }).pluck("key")).toEqual(["users"]);
});
