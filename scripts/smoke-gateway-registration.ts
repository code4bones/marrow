// D-MEMORY-016 / T-MEMORY-038 + T-MEMORY-028: covers the open self-registration
// path (register -> register/confirm -> pending_approval -> admin approve/reject
// -> login/2fa) and the shared TOTP bind/unbind profile section, end to end
// against the real gateway (ephemeral local instance, real Postgres) — same
// style as scripts/smoke-gateway-auth.ts, which this complements rather than
// duplicates (that script still owns invite/claim/verify-email coverage).
import { createHmac, randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword } from "../src/gateway/auth.js";
import { base32Decode } from "../src/gateway/totp.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";

// TOTP_ENC_KEY must be set before any TOTP-touching route is exercised (it's
// read lazily by src/gateway/totp.ts on each call, not at import time), so
// set it as early as possible in this single-process smoke run.
if (!process.env.TOTP_ENC_KEY) {
  process.env.TOTP_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
}

const db = createPgKnex();
const service = new PgToolService(db);
const token = `gateway-registration-smoke-token-${Date.now()}`;
const auth = createAuthFacade(db);
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token,
  auth
});

const unique = Date.now();
const adminEmail = `gateway-registration-smoke-admin-${unique}@example.test`;
const adminPassword = "smoke-admin-password-1";
const applicantEmail = `gateway-registration-smoke-applicant-${unique}@example.test`;
const applicantPassword = "smoke-applicant-password-1";
const rejectedEmail = `gateway-registration-smoke-rejected-${unique}@example.test`;
const rejectedPassword = "smoke-rejected-password-1";
const bootstrapStyleEmail = `gateway-registration-smoke-bootstrap-${unique}@example.test`;
const bootstrapStylePassword = "smoke-bootstrap-password-1";
const graphqlPath = `${normalizedApiEndpoint() ?? ""}/graphql`;
const graphqlUrl = `${started.url}${graphqlPath}`;

const userIdsToClean: string[] = [];

try {
  const now = new Date();
  const adminUserId = randomUUID();
  userIdsToClean.push(adminUserId);
  await db("users").insert({
    id: adminUserId,
    email: adminEmail,
    password_hash: await hashPassword(adminPassword),
    email_verified_at: now,
    totp_enabled: false,
    role: "admin",
    status: "active",
    created_at: now,
    updated_at: now
  });

  const adminLogin = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: adminPassword })
  });
  assert(adminLogin.status === 200, `Admin login failed. Status: ${adminLogin.status}`);
  const adminCookie = sessionCookieFrom(adminLogin);
  assert(adminCookie, "Admin login did not set a session cookie.");
  console.log("ok - registration smoke: admin session established");

  // --- register -> register/confirm ---

  const register = await fetch(`${started.url}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: applicantEmail, password: applicantPassword })
  });
  assert(register.status === 200, `POST /auth/register failed. Status: ${register.status}`);
  const registerBody = (await register.json()) as {
    data: { token: string; otpauthUrl: string; secretBase32: string };
  };
  assert(registerBody.data.token, "register did not return a confirm token.");
  assert(registerBody.data.secretBase32, "register did not return a TOTP secret.");
  assert(registerBody.data.otpauthUrl.startsWith("otpauth://totp/"), "register did not return a valid otpauth URL.");
  console.log("ok - auth register creates a pending registration and returns a TOTP secret");

  const registerDuplicate = await fetch(`${started.url}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: applicantEmail, password: applicantPassword })
  });
  assert(registerDuplicate.status === 400, `Duplicate in-flight registration was not rejected. Status: ${registerDuplicate.status}`);
  console.log("ok - auth register rejects a duplicate email still pending confirmation");

  const confirmWrongCode = await fetch(`${started.url}/auth/register/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: registerBody.data.token, code: "000000" })
  });
  assert(confirmWrongCode.status === 401, `Wrong TOTP code on register/confirm was not rejected. Status: ${confirmWrongCode.status}`);
  console.log("ok - auth register/confirm rejects a wrong TOTP code");

  const confirmCode = currentTotpCode(registerBody.data.secretBase32);
  const confirm = await fetch(`${started.url}/auth/register/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: registerBody.data.token, code: confirmCode })
  });
  assert(confirm.status === 200, `POST /auth/register/confirm failed. Status: ${confirm.status}`);
  const confirmBody = (await confirm.json()) as { data: { email: string; recoveryCodes: string[] } };
  assert(confirmBody.data.email === applicantEmail, "register/confirm returned the wrong email.");
  assert(confirmBody.data.recoveryCodes.length === 10, "register/confirm should return exactly 10 recovery codes.");
  console.log("ok - auth register/confirm creates a pending_approval user with 10 recovery codes");

  const applicantRow = await db("users").where({ email: applicantEmail }).first();
  assert(applicantRow, "register/confirm did not create a users row.");
  const applicantUserId = applicantRow.id as string;
  userIdsToClean.push(applicantUserId);
  assert(applicantRow.status === "pending_approval", "Newly confirmed self-registration should be pending_approval.");
  assert(applicantRow.totp_enabled === true, "Newly confirmed self-registration should have totp_enabled=true.");
  assert(!applicantRow.email_verified_at, "Self-registered accounts should not have email_verified_at set.");

  const confirmReplay = await fetch(`${started.url}/auth/register/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: registerBody.data.token, code: currentTotpCode(registerBody.data.secretBase32) })
  });
  assert(confirmReplay.status === 400, `Replaying a consumed register token was not rejected. Status: ${confirmReplay.status}`);
  console.log("ok - auth register/confirm token is single-use");

  // --- login while pending_approval ---

  const loginPending = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: applicantEmail, password: applicantPassword })
  });
  assert(loginPending.status === 401, `Login while pending_approval was not rejected. Status: ${loginPending.status}`);
  const loginPendingBody = (await loginPending.json()) as { error?: { message?: string } };
  assert(
    loginPendingBody.error?.message === "Your account is waiting for admin approval.",
    `Login while pending_approval returned the wrong message: ${loginPendingBody.error?.message}`
  );
  console.log("ok - auth login gives a distinct message while a self-registered account awaits approval");

  // --- admin sees + approves ---

  const pendingList = await fetch(`${started.url}/auth/admin/pending-users`, { headers: { cookie: adminCookie! } });
  assert(pendingList.status === 200, `GET /auth/admin/pending-users failed. Status: ${pendingList.status}`);
  const pendingListBody = (await pendingList.json()) as { data: { id: string; email: string }[] };
  assert(
    pendingListBody.data.some((row) => row.email === applicantEmail),
    "Pending-users list did not include the newly registered applicant."
  );
  console.log("ok - auth admin pending-users lists the newly registered account");

  const pendingListUnauthorized = await fetch(`${started.url}/auth/admin/pending-users`);
  assert(pendingListUnauthorized.status === 401, `Pending-users list without admin session was not rejected. Status: ${pendingListUnauthorized.status}`);
  console.log("ok - auth admin pending-users requires an admin session");

  const approve = await fetch(`${started.url}/auth/admin/pending-users/${applicantUserId}/approve`, {
    method: "POST",
    headers: { cookie: adminCookie! }
  });
  assert(approve.status === 200, `Approve failed. Status: ${approve.status}`);
  const approvedRow = await db("users").where({ id: applicantUserId }).first();
  assert(approvedRow.status === "active", "Approve should set status=active.");
  console.log("ok - auth admin approve activates the account");

  // --- login now yields pending_totp, then /auth/login/2fa ---

  const loginAfterApprove = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: applicantEmail, password: applicantPassword })
  });
  assert(loginAfterApprove.status === 200, `Login after approve failed. Status: ${loginAfterApprove.status}`);
  const loginAfterApproveBody = (await loginAfterApprove.json()) as { data: { status: string; userId?: string } };
  assert(loginAfterApproveBody.data.status === "pending_totp", "Login after approve should return pending_totp (totp_enabled=true).");
  const loginUserId = loginAfterApproveBody.data.userId as string;
  assert(loginUserId === applicantUserId, "pending_totp userId mismatch.");
  console.log("ok - auth login returns pending_totp for an approved, totp-enabled account");

  const login2faWrong = await fetch(`${started.url}/auth/login/2fa`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: loginUserId, code: "000000" })
  });
  assert(login2faWrong.status === 401, `Wrong login/2fa code was not rejected. Status: ${login2faWrong.status}`);
  console.log("ok - auth login/2fa rejects a wrong TOTP code");

  const login2faCode = currentTotpCode(registerBody.data.secretBase32);
  const login2fa = await fetch(`${started.url}/auth/login/2fa`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: loginUserId, code: login2faCode })
  });
  assert(login2fa.status === 200, `POST /auth/login/2fa failed. Status: ${login2fa.status}`);
  const applicantCookie = sessionCookieFrom(login2fa);
  assert(applicantCookie, "auth login/2fa did not set a session cookie.");
  const login2faBody = (await login2fa.json()) as { data: { status: string; user: { id: string; role: string } } };
  assert(login2faBody.data.status === "session", "auth login/2fa should return status session on success.");
  assert(login2faBody.data.user.role === "member", "Self-registered accounts should default to role=member.");
  console.log("ok - auth login/2fa with a correct TOTP code issues a session");

  const graphqlWithSession = await fetch(graphqlUrl, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: applicantCookie! },
    body: JSON.stringify({ query: "{ gatewayStatus }" })
  });
  assert(graphqlWithSession.status === 200, `GraphQL over registration-flow session cookie failed. Status: ${graphqlWithSession.status}`);
  const graphqlBody = (await graphqlWithSession.json()) as { data?: { gatewayStatus: { storage: string } } };
  assert(graphqlBody.data?.gatewayStatus.storage === "postgresql", "GraphQL over session cookie returned unexpected data.");
  console.log("ok - graphql accepts a session cookie issued via the registration + login/2fa flow");

  // --- recovery-code login, single-use ---

  const recoveryLogoutFirst = await fetch(`${started.url}/auth/logout`, {
    method: "POST",
    headers: { cookie: applicantCookie! }
  });
  assert(recoveryLogoutFirst.status === 200, "Logout before recovery-code test failed.");

  const loginBeforeRecovery = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: applicantEmail, password: applicantPassword })
  });
  const loginBeforeRecoveryBody = (await loginBeforeRecovery.json()) as { data: { userId: string } };

  const recoveryCode = confirmBody.data.recoveryCodes[0];
  const recoveryLogin = await fetch(`${started.url}/auth/login/2fa`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: loginBeforeRecoveryBody.data.userId, code: recoveryCode })
  });
  assert(recoveryLogin.status === 200, `Recovery-code login/2fa failed. Status: ${recoveryLogin.status}`);
  const recoveryCookie = sessionCookieFrom(recoveryLogin);
  assert(recoveryCookie, "Recovery-code login did not set a session cookie.");
  console.log("ok - auth login/2fa accepts an unused recovery code");

  const loginBeforeRecoveryReplay = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: applicantEmail, password: applicantPassword })
  });
  const loginBeforeRecoveryReplayBody = (await loginBeforeRecoveryReplay.json()) as { data: { userId: string } };
  const recoveryReplay = await fetch(`${started.url}/auth/login/2fa`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: loginBeforeRecoveryReplayBody.data.userId, code: recoveryCode })
  });
  assert(recoveryReplay.status === 401, `Reusing a recovery code was not rejected. Status: ${recoveryReplay.status}`);
  console.log("ok - auth login/2fa recovery codes are single-use");

  // --- second registration, admin rejects ---

  const registerRejected = await fetch(`${started.url}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: rejectedEmail, password: rejectedPassword })
  });
  assert(registerRejected.status === 200, `Second registration failed. Status: ${registerRejected.status}`);
  const registerRejectedBody = (await registerRejected.json()) as {
    data: { token: string; secretBase32: string };
  };
  const confirmRejected = await fetch(`${started.url}/auth/register/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: registerRejectedBody.data.token,
      code: currentTotpCode(registerRejectedBody.data.secretBase32)
    })
  });
  assert(confirmRejected.status === 200, `Second registration confirm failed. Status: ${confirmRejected.status}`);
  const rejectedRow = await db("users").where({ email: rejectedEmail }).first();
  assert(rejectedRow, "Second registration did not create a users row.");
  const rejectedUserId = rejectedRow.id as string;
  userIdsToClean.push(rejectedUserId);

  const reject = await fetch(`${started.url}/auth/admin/pending-users/${rejectedUserId}/reject`, {
    method: "POST",
    headers: { cookie: adminCookie! }
  });
  assert(reject.status === 200, `Reject failed. Status: ${reject.status}`);
  const rejectedAfter = await db("users").where({ id: rejectedUserId }).first();
  assert(rejectedAfter.status === "disabled", "Reject should set status=disabled.");
  console.log("ok - auth admin reject disables the account");

  const loginAfterReject = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: rejectedEmail, password: rejectedPassword })
  });
  assert(loginAfterReject.status === 401, `Login after reject was not rejected. Status: ${loginAfterReject.status}`);
  const loginAfterRejectBody = (await loginAfterReject.json()) as { error?: { message?: string } };
  assert(
    loginAfterRejectBody.error?.message === "This account has been disabled.",
    `Login after reject returned the wrong message: ${loginAfterRejectBody.error?.message}`
  );
  console.log("ok - auth login after reject gives the disabled message");

  // --- expired register token ---

  const expiredRegister = await fetch(`${started.url}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `gateway-registration-smoke-expired-${unique}@example.test`, password: "smoke-expired-password-1" })
  });
  assert(expiredRegister.status === 200, `Expired-token setup registration failed. Status: ${expiredRegister.status}`);
  const expiredRegisterBody = (await expiredRegister.json()) as { data: { token: string; secretBase32: string } };
  await db("pending_registrations")
    .where({ email: `gateway-registration-smoke-expired-${unique}@example.test` })
    .update({ expires_at: new Date(Date.now() - 1000) });
  const expiredConfirm = await fetch(`${started.url}/auth/register/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: expiredRegisterBody.data.token,
      code: currentTotpCode(expiredRegisterBody.data.secretBase32)
    })
  });
  assert(expiredConfirm.status === 400, `Expired register token was not rejected. Status: ${expiredConfirm.status}`);
  console.log("ok - auth register/confirm rejects an expired token");
  await db("pending_registrations").where({ email: `gateway-registration-smoke-expired-${unique}@example.test` }).del();

  // --- shared 2FA bind/unbind profile section, for an already-logged-in
  // (bootstrap-style, password-only) account ---

  const bootstrapStyleId = randomUUID();
  userIdsToClean.push(bootstrapStyleId);
  await db("users").insert({
    id: bootstrapStyleId,
    email: bootstrapStyleEmail,
    password_hash: await hashPassword(bootstrapStylePassword),
    email_verified_at: now,
    totp_enabled: false,
    role: "admin",
    status: "active",
    created_at: now,
    updated_at: now
  });
  const bootstrapStyleLogin = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: bootstrapStyleEmail, password: bootstrapStylePassword })
  });
  assert(bootstrapStyleLogin.status === 200, `Bootstrap-style login failed. Status: ${bootstrapStyleLogin.status}`);
  const bootstrapStyleCookie = sessionCookieFrom(bootstrapStyleLogin);
  assert(bootstrapStyleCookie, "Bootstrap-style login did not set a session cookie.");
  console.log("ok - registration smoke: password-only (bootstrap-style) account can log in without TOTP");

  const enroll = await fetch(`${started.url}/auth/2fa/enroll`, {
    method: "POST",
    headers: { cookie: bootstrapStyleCookie! }
  });
  assert(enroll.status === 200, `2fa/enroll failed. Status: ${enroll.status}`);
  const enrollBody = (await enroll.json()) as { data: { otpauthUrl: string; secretBase32: string } };
  assert(enrollBody.data.secretBase32, "2fa/enroll did not return a secret.");
  console.log("ok - auth 2fa/enroll issues a TOTP secret for an already-logged-in account");

  const enrollWithoutSession = await fetch(`${started.url}/auth/2fa/enroll`, { method: "POST" });
  assert(enrollWithoutSession.status === 401, `2fa/enroll without a session was not rejected. Status: ${enrollWithoutSession.status}`);
  console.log("ok - auth 2fa/enroll requires a session");

  const confirmWrong = await fetch(`${started.url}/auth/2fa/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: bootstrapStyleCookie! },
    body: JSON.stringify({ code: "000000" })
  });
  assert(confirmWrong.status === 401, `2fa/confirm with a wrong code was not rejected. Status: ${confirmWrong.status}`);

  const confirm2fa = await fetch(`${started.url}/auth/2fa/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: bootstrapStyleCookie! },
    body: JSON.stringify({ code: currentTotpCode(enrollBody.data.secretBase32) })
  });
  assert(confirm2fa.status === 200, `2fa/confirm failed. Status: ${confirm2fa.status}`);
  const confirm2faBody = (await confirm2fa.json()) as { data: { recoveryCodes: string[] } };
  assert(confirm2faBody.data.recoveryCodes.length === 10, "2fa/confirm should return 10 recovery codes.");
  console.log("ok - auth 2fa/confirm enables TOTP and returns recovery codes once");

  const bootstrapStyleRowEnabled = await db("users").where({ id: bootstrapStyleId }).first();
  assert(bootstrapStyleRowEnabled.totp_enabled === true, "totp_enabled should be true after confirm.");

  const regenerate = await fetch(`${started.url}/auth/2fa/recovery-codes/regenerate`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: bootstrapStyleCookie! },
    body: JSON.stringify({ currentPassword: bootstrapStylePassword })
  });
  assert(regenerate.status === 200, `2fa recovery-codes regenerate failed. Status: ${regenerate.status}`);
  const regenerateBody = (await regenerate.json()) as { data: { recoveryCodes: string[] } };
  assert(regenerateBody.data.recoveryCodes.length === 10, "Regenerate should return 10 fresh recovery codes.");
  assert(
    regenerateBody.data.recoveryCodes[0] !== confirm2faBody.data.recoveryCodes[0],
    "Regenerated recovery codes should differ from the originals."
  );
  console.log("ok - auth 2fa recovery-codes regenerate replaces the stored codes");

  const disableWrongPassword = await fetch(`${started.url}/auth/2fa/disable`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: bootstrapStyleCookie! },
    body: JSON.stringify({ currentPassword: "not-the-password" })
  });
  assert(disableWrongPassword.status === 401, `2fa/disable with wrong password was not rejected. Status: ${disableWrongPassword.status}`);

  const disable = await fetch(`${started.url}/auth/2fa/disable`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: bootstrapStyleCookie! },
    body: JSON.stringify({ currentPassword: bootstrapStylePassword })
  });
  assert(disable.status === 200, `2fa/disable failed. Status: ${disable.status}`);
  const bootstrapStyleRowDisabled = await db("users").where({ id: bootstrapStyleId }).first();
  assert(bootstrapStyleRowDisabled.totp_enabled === false, "totp_enabled should be false after disable.");
  assert(!bootstrapStyleRowDisabled.totp_secret, "totp_secret should be cleared after disable.");
  console.log("ok - auth 2fa/disable requires the current password and clears TOTP state");

  // --- profile password change ---

  const changePassword = await fetch(`${started.url}/auth/profile/password`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: bootstrapStyleCookie! },
    body: JSON.stringify({ currentPassword: bootstrapStylePassword, newPassword: "smoke-bootstrap-password-2" })
  });
  assert(changePassword.status === 200, `profile/password failed. Status: ${changePassword.status}`);
  const loginWithNewPassword = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: bootstrapStyleEmail, password: "smoke-bootstrap-password-2" })
  });
  assert(loginWithNewPassword.status === 200, `Login with new password failed. Status: ${loginWithNewPassword.status}`);
  console.log("ok - auth profile/password changes the password after verifying the current one");

  // --- TOTP_ENC_KEY missing/invalid fails loudly ---

  const savedKey = process.env.TOTP_ENC_KEY;
  delete process.env.TOTP_ENC_KEY;
  const registerWithoutKey = await fetch(`${started.url}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `gateway-registration-smoke-nokey-${unique}@example.test`, password: "smoke-nokey-password-1" })
  });
  assert(
    registerWithoutKey.status === 400,
    `POST /auth/register without TOTP_ENC_KEY should fail loudly, not silently succeed. Status: ${registerWithoutKey.status}`
  );
  const noKeyRow = await db("pending_registrations")
    .where({ email: `gateway-registration-smoke-nokey-${unique}@example.test` })
    .first();
  assert(!noKeyRow, "No pending_registrations row (with a plaintext-adjacent secret) should be written when TOTP_ENC_KEY is missing.");
  process.env.TOTP_ENC_KEY = savedKey;
  console.log("ok - auth register fails loudly (400) when TOTP_ENC_KEY is not configured, and writes nothing");

  console.log(`Gateway registration smoke test passed using ${started.url}`);
} finally {
  for (const userId of userIdsToClean) {
    await db("sessions").where({ user_id: userId }).del();
    await db("tokens").where({ user_id: userId }).del();
    await db("users").where({ id: userId }).del();
  }
  await db("pending_registrations")
    .where("email", "like", `gateway-registration-smoke-%-${unique}@example.test`)
    .del();
  await started.stop();
  await service.close();
}

function sessionCookieFrom(response: Response): string | null {
  const raw = response.headers.get("set-cookie");
  if (!raw) {
    return null;
  }
  return raw.split(";")[0] ?? null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizedApiEndpoint(): string | null {
  const raw = process.env.API_ENDPOINT?.trim();
  if (!raw || raw === "/") {
    return null;
  }
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

/**
 * Standalone RFC 6238 code generator for this script's own assertions —
 * mirrors the algorithm in src/gateway/totp.ts (HMAC-SHA1 dynamic
 * truncation, 30s step, 6 digits) without importing its private hotp()
 * helper, so the smoke test exercises the real verify path against an
 * independently computed code rather than round-tripping through the
 * module under test.
 */
function currentTotpCode(secretBase32: string): string {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binCode % 10 ** 6).toString().padStart(6, "0");
}
