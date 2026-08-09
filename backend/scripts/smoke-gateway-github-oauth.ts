// GitHub OAuth sign-in/link (option 2, owner-approved): exercises
// auth.ts's DB-only logic directly (registerViaGithub, registerConfirm's
// provider="github" branch, loginViaGithub, link/unlink, oauth state
// mint/consume) against a real Postgres instance, same style as
// smoke-gateway-registration.ts. Deliberately does NOT call resolveGithubUser
// (src/gateway/github-oauth.ts) -- that function's only job is talking to
// real github.com, which has no place in an automated smoke suite; it's
// exercised manually against a real GitHub OAuth App instead.
import { createHmac, randomUUID } from "node:crypto";
import { createAuthFacade, hashPassword } from "../src/gateway/auth.js";
import { base32Decode } from "../src/gateway/totp.js";
import { createPgKnex } from "../src/shared/pg/knex.js";

// TOTP_ENC_KEY must be set before any TOTP-touching call is exercised (it's
// read lazily by src/gateway/totp.ts on each call, not at import time) --
// same guard as scripts/smoke-gateway-registration.ts.
if (!process.env.TOTP_ENC_KEY) {
  process.env.TOTP_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
}

const db = createPgKnex();
const auth = createAuthFacade(db);
const unique = Date.now();

let githubUserId: string | undefined;
let linkedUserId: string | undefined;

try {
  // --- registerViaGithub -> registerConfirm creates a user + github_identities row, no password ---
  const email = `github-smoke-${unique}@example.test`;
  const githubId = `gh-${unique}-1`;
  const started = await auth.registerViaGithub(email, githubId, "octocat-smoke");
  assert(started.otpauthUrl.startsWith("otpauth://totp/"), "registerViaGithub should return a valid otpauth URL.");
  console.log("ok - registerViaGithub creates a pending registration with a TOTP secret, no password required");

  const pendingContext = await auth.pendingRegistrationContext(started.token);
  assert(pendingContext.email === email.toLowerCase(), "pendingRegistrationContext should return the pending email.");
  assert(pendingContext.secretBase32 === started.secretBase32, "pendingRegistrationContext should return the same TOTP secret (not consumed by reading it).");
  console.log("ok - GET-equivalent pendingRegistrationContext returns the same secret without consuming the pending registration");

  const confirmed = await auth.registerConfirm(started.token, currentTotpCode(started.secretBase32));
  assert(confirmed.email === email.toLowerCase(), "registerConfirm should return the confirmed email.");
  const userRow = await db("users").where({ email: email.toLowerCase() }).first();
  githubUserId = userRow.id as string;
  assert(userRow.password_hash === null, "A GitHub-originated user should have no password_hash.");
  assert(userRow.status === "pending_approval", "A GitHub-originated user still waits for admin approval, same as a password signup.");
  assert(userRow.totp_enabled === true, "A GitHub-originated user still has TOTP enabled, same as a password signup.");
  const identityRow = await db("github_identities").where({ user_id: githubUserId }).first();
  assert(identityRow && identityRow.github_id === githubId, "registerConfirm should have created a github_identities row linking this user.");
  console.log("ok - registerConfirm(provider=github) creates a passwordless, pending_approval, totp_enabled user + a github_identities link, atomically");

  // --- loginViaGithub respects the same approval/status gates as password login ---
  const beforeApproval = await auth.loginViaGithub(githubId, {});
  assert(false, "loginViaGithub should have thrown for a pending_approval account: " + JSON.stringify(beforeApproval));
} catch (error) {
  assert(
    error instanceof Error && error.message.includes("waiting for admin approval"),
    `Expected the pending-approval AppError, got: ${error instanceof Error ? error.message : error}`
  );
  console.log("ok - loginViaGithub refuses a pending_approval account, same message as password login");
}

try {
  await auth.approveUser(githubUserId!);
  const afterApproval = await auth.loginViaGithub(`gh-${unique}-1`, {});
  assert(afterApproval.status === "pending_totp", `Expected pending_totp after approval (totp_enabled=true), got ${afterApproval.status}`);
  assert((afterApproval as { userId: string }).userId === githubUserId, "pending_totp userId mismatch.");
  console.log("ok - loginViaGithub returns pending_totp for an approved, totp-enabled account (GitHub replaces the password step only, not the TOTP step)");

  const notLinked = await auth.loginViaGithub(`gh-${unique}-does-not-exist`, {});
  assert(notLinked.status === "not_linked", "An unrecognized github_id should return not_linked, not throw.");
  console.log("ok - loginViaGithub returns not_linked (not an error) for an unrecognized GitHub account");

  // --- link/unlink for an already-existing (password) account ---
  const linkedEmail = `github-link-smoke-${unique}@example.test`;
  const now = new Date();
  linkedUserId = randomUUID();
  await db("users").insert({
    id: linkedUserId,
    email: linkedEmail,
    password_hash: await hashPassword("smoke-link-password-1"),
    email_verified_at: now,
    totp_enabled: false,
    role: "member",
    status: "active",
    created_at: now,
    updated_at: now
  });
  const linkGithubId = `gh-${unique}-2`;
  await auth.linkGithubIdentity(linkedUserId, linkGithubId, "octocat-link-smoke");
  const status = await auth.githubLinkStatus(linkedUserId);
  assert(status.linked && status.githubLogin === "octocat-link-smoke", "githubLinkStatus should reflect the newly linked identity.");
  console.log("ok - linkGithubIdentity links an existing (password) account, githubLinkStatus reflects it");

  try {
    await auth.linkGithubIdentity(githubUserId!, linkGithubId, "octocat-link-smoke");
    assert(false, "Linking a GitHub id already linked to a different account should have thrown.");
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes("already linked to a different Marrow account"),
      `Expected the already-linked-elsewhere error, got: ${error instanceof Error ? error.message : error}`
    );
  }
  console.log("ok - linkGithubIdentity refuses to link a GitHub account that's already linked to someone else");

  await auth.unlinkGithubIdentity(linkedUserId);
  const afterUnlink = await auth.githubLinkStatus(linkedUserId);
  assert(!afterUnlink.linked, "githubLinkStatus should show unlinked after unlinkGithubIdentity.");
  console.log("ok - unlinkGithubIdentity removes the link for an account that has a password (another way to sign in)");

  try {
    await auth.unlinkGithubIdentity(githubUserId!);
    assert(false, "Unlinking a passwordless (GitHub-only) account's only identity should have thrown.");
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes("only way to sign in"),
      `Expected the only-way-to-sign-in guard, got: ${error instanceof Error ? error.message : error}`
    );
  }
  console.log("ok - unlinkGithubIdentity refuses to unlink a GitHub-only account's sole sign-in method");

  // --- oauth_login_states CSRF token: single-use, intent-carrying ---
  const loginState = await auth.mintOAuthState("login", null);
  const consumedLogin = await auth.consumeOAuthState(loginState);
  assert(consumedLogin.intent === "login" && consumedLogin.userId === null, "consumeOAuthState should return the minted intent/userId.");
  try {
    await auth.consumeOAuthState(loginState);
    assert(false, "Consuming the same oauth state twice should have thrown (single-use).");
  } catch (error) {
    assert(error instanceof Error, "Expected an error consuming an already-used oauth state.");
  }
  const linkState = await auth.mintOAuthState("link", linkedUserId);
  const consumedLink = await auth.consumeOAuthState(linkState);
  assert(consumedLink.intent === "link" && consumedLink.userId === linkedUserId, "consumeOAuthState should carry the userId through for intent=link.");
  console.log("ok - mintOAuthState/consumeOAuthState round-trips intent + userId and is single-use");

  console.log("GitHub OAuth smoke test passed.");
} finally {
  if (githubUserId) {
    await db("sessions").where({ user_id: githubUserId }).del();
    await db("github_identities").where({ user_id: githubUserId }).del();
    await db("users").where({ id: githubUserId }).del();
  }
  if (linkedUserId) {
    await db("sessions").where({ user_id: linkedUserId }).del();
    await db("github_identities").where({ user_id: linkedUserId }).del();
    await db("users").where({ id: linkedUserId }).del();
  }
  await db("pending_registrations").where("email", "like", `github-%-smoke-${unique}@example.test`).del();
  await db.destroy();
}

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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
