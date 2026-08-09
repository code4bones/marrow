import { randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword } from "../src/gateway/auth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";

const db = createPgKnex();
const service = new PgToolService(db);
const token = `gateway-auth-smoke-token-${Date.now()}`;
const auth = createAuthFacade(db);
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token,
  auth
});

const unique = Date.now();
const adminEmail = `gateway-auth-smoke-admin-${unique}@example.test`;
const adminPassword = "smoke-admin-password-1";
const memberEmail = `gateway-auth-smoke-member-${unique}@example.test`;
const memberPassword = "smoke-member-password-1";
const graphqlPath = `${normalizedApiEndpoint() ?? ""}/graphql`;
const graphqlUrl = `${started.url}${graphqlPath}`;

let adminUserId: string | undefined;
let memberUserId: string | undefined;

try {
  const now = new Date();
  adminUserId = randomUUID();
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

  const bootstrapStatus = await fetch(`${started.url}/auth/bootstrap`);
  assert(bootstrapStatus.status === 200, `GET /auth/bootstrap failed. Status: ${bootstrapStatus.status}`);
  const bootstrapStatusBody = (await bootstrapStatus.json()) as { data: { adminExists: boolean } };
  assert(bootstrapStatusBody.data.adminExists === true, "adminExists should be true once an admin has been seeded.");
  console.log("ok - auth bootstrap status reports an admin already exists");

  const bootstrapRejected = await fetch(`${started.url}/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "should-not-be-created@example.test", password: "irrelevant-password" })
  });
  assert(bootstrapRejected.status === 400, `POST /auth/bootstrap did not reject with an existing admin. Status: ${bootstrapRejected.status}`);
  const rejectedUser = await db("users").where({ email: "should-not-be-created@example.test" }).first();
  assert(!rejectedUser, "Bootstrap must not create a user once an admin already exists.");
  console.log("ok - auth bootstrap refuses to run once an admin exists");

  const loginWrongPassword = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: "not-the-password" })
  });
  assert(loginWrongPassword.status === 401, `Wrong password did not return 401. Status: ${loginWrongPassword.status}`);
  console.log("ok - auth login rejects wrong password");

  const adminLogin = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: adminPassword })
  });
  assert(adminLogin.status === 200, `Admin login failed. Status: ${adminLogin.status}`);
  const adminCookie = sessionCookieFrom(adminLogin);
  assert(adminCookie, "Admin login did not set a session cookie.");
  console.log("ok - auth login issues session cookie");

  const inviteUnauthorized = await fetch(`${started.url}/auth/invite`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: memberEmail })
  });
  assert(inviteUnauthorized.status === 401, `Invite without a session was not rejected. Status: ${inviteUnauthorized.status}`);
  console.log("ok - auth invite requires admin session");

  const invite = await fetch(`${started.url}/auth/invite`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie! },
    body: JSON.stringify({ email: memberEmail })
  });
  assert(invite.status === 200, `Invite failed. Status: ${invite.status}`);
  const inviteBody = (await invite.json()) as { data: { email: string; claimPath: string } };
  assert(inviteBody.data.email === memberEmail, "Invite response email mismatch.");
  const claimToken = new URL(inviteBody.data.claimPath, started.url).searchParams.get("token");
  assert(claimToken, "Invite response did not include a usable claim token.");
  console.log("ok - auth invite creates a claimable token");

  const claimContext = await fetch(`${started.url}/auth/claim?token=${claimToken}`);
  assert(claimContext.status === 200, `GET /auth/claim failed. Status: ${claimContext.status}`);
  const claimContextBody = (await claimContext.json()) as { data: { email: string; purpose: string } };
  assert(claimContextBody.data.email === memberEmail, "Claim context returned wrong email.");
  assert(claimContextBody.data.purpose === "invite", "Claim context returned wrong purpose.");
  console.log("ok - auth claim context resolves invite token");

  const loginBeforeClaim = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: memberEmail, password: memberPassword })
  });
  assert(loginBeforeClaim.status === 401, `Login before claim was not rejected. Status: ${loginBeforeClaim.status}`);
  console.log("ok - auth login rejects an account that has not been claimed yet");

  const claim = await fetch(`${started.url}/auth/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: claimToken, password: memberPassword })
  });
  assert(claim.status === 200, `POST /auth/claim failed. Status: ${claim.status}`);
  const claimBody = (await claim.json()) as {
    data: { email: string; emailVerified: boolean; verifyEmailPath?: string };
  };
  assert(claimBody.data.emailVerified === false, "Freshly claimed account should not be email-verified yet.");
  const verifyToken = claimBody.data.verifyEmailPath
    ? new URL(claimBody.data.verifyEmailPath, started.url).searchParams.get("token")
    : null;
  assert(verifyToken, "Claim response did not include a verify-email token.");
  console.log("ok - auth claim sets a password and issues a verify-email token");

  const claimReplay = await fetch(`${started.url}/auth/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: claimToken, password: memberPassword })
  });
  assert(claimReplay.status === 400, `Reusing a claim token was not rejected. Status: ${claimReplay.status}`);
  console.log("ok - auth claim token is single-use");

  const loginBeforeVerify = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: memberEmail, password: memberPassword })
  });
  assert(loginBeforeVerify.status === 401, `Login before email verification was not rejected. Status: ${loginBeforeVerify.status}`);
  console.log("ok - auth login rejects an unverified email");

  const verify = await fetch(`${started.url}/auth/verify-email?token=${verifyToken}`, { method: "POST" });
  assert(verify.status === 200, `POST /auth/verify-email failed. Status: ${verify.status}`);
  console.log("ok - auth verify-email marks the account verified");

  const memberLogin = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: memberEmail, password: memberPassword })
  });
  assert(memberLogin.status === 200, `Member login failed after verification. Status: ${memberLogin.status}`);
  const memberCookie = sessionCookieFrom(memberLogin);
  assert(memberCookie, "Member login did not set a session cookie.");
  const memberLoginBody = (await memberLogin.json()) as { data: { user: { id: string; role: string } } };
  memberUserId = memberLoginBody.data.user.id;
  assert(memberLoginBody.data.user.role === "member", "Claimed invite did not default to the member role.");
  console.log("ok - auth login succeeds once verified, issues session");

  const me = await fetch(`${started.url}/auth/me`, { headers: { cookie: memberCookie! } });
  assert(me.status === 200, `GET /auth/me failed. Status: ${me.status}`);
  const meBody = (await me.json()) as { data: { id: string; email: string; role: string } };
  assert(meBody.data.email === memberEmail, "/auth/me returned the wrong user.");
  console.log("ok - auth me resolves the session cookie to the current user");

  const meWithoutCookie = await fetch(`${started.url}/auth/me`);
  assert(meWithoutCookie.status === 401, `GET /auth/me without a cookie was not rejected. Status: ${meWithoutCookie.status}`);
  console.log("ok - auth me requires a session");

  const graphqlWithSession = await fetch(graphqlUrl, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: memberCookie! },
    body: JSON.stringify({ query: "{ gatewayStatus }" })
  });
  assert(graphqlWithSession.status === 200, `GraphQL over session cookie failed. Status: ${graphqlWithSession.status}`);
  const graphqlBody = (await graphqlWithSession.json()) as { data?: { gatewayStatus: { storage: string } } };
  assert(graphqlBody.data?.gatewayStatus.storage === "postgresql", "GraphQL over session cookie returned unexpected data.");
  console.log("ok - graphql accepts session cookie alongside bearer token");

  const logout = await fetch(`${started.url}/auth/logout`, { method: "POST", headers: { cookie: memberCookie! } });
  assert(logout.status === 200, `Logout failed. Status: ${logout.status}`);
  console.log("ok - auth logout revokes the session");

  const graphqlAfterLogout = await fetch(graphqlUrl, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: memberCookie! },
    body: JSON.stringify({ query: "{ gatewayStatus }" })
  });
  assert(graphqlAfterLogout.status === 401, `Revoked session cookie still authorized. Status: ${graphqlAfterLogout.status}`);
  console.log("ok - auth logout invalidates the cookie for later requests");

  // Placed last and deliberately: by this point the shared IP-keyed counter
  // was already reset by memberLogin's success above, and nothing after
  // this calls /auth/login again — so tripping it here can't leak into any
  // earlier assertion in this run.
  const rateLimitEmail = `gateway-auth-smoke-ratelimit-${unique}@example.test`;
  let lastRateLimitStatus = 0;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const response = await fetch(`${started.url}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: rateLimitEmail, password: "wrong-password" })
    });
    lastRateLimitStatus = response.status;
  }
  assert(
    lastRateLimitStatus === 429,
    `9th login attempt for the same email should be rate-limited (429). Got: ${lastRateLimitStatus}`
  );
  console.log("ok - auth login rate-limits repeated attempts");

  // T-MEMORY-058 (whitebox pentest finding #2, I-MEMORY-055): clientIp() used
  // to take the leftmost X-Forwarded-For value, which a client can set to
  // anything -- rotating it per request used to get a fresh ip:<clientIp>
  // rate-limit bucket every time, defeating the IP half of the limiter (the
  // per-email half still caught same-account brute force, but the
  // cross-account "one attacker IP, many target accounts" protection was
  // gone). A different email each attempt keeps the per-email bucket from
  // ever tripping, isolating this to the IP bucket specifically. X-Real-IP
  // is what nginx actually sets in prod (unconditionally overwritten with
  // the real peer, unlike XFF) -- held constant here to prove the limiter
  // now keys on it instead of the attacker-rotated XFF.
  let lastXffSpoofStatus = 0;
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const response = await fetch(`${started.url}/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "203.0.113.9",
        "x-forwarded-for": `198.51.100.${attempt}`
      },
      body: JSON.stringify({ email: `gateway-auth-smoke-xffspoof-${unique}-${attempt}@example.test`, password: "wrong-password" })
    });
    lastXffSpoofStatus = response.status;
  }
  assert(
    lastXffSpoofStatus === 429,
    `A constant X-Real-IP with a different email + rotated X-Forwarded-For every attempt should still be rate-limited by IP (429). Got: ${lastXffSpoofStatus}`
  );
  console.log("ok - rotating X-Forwarded-For no longer defeats the IP-keyed rate limiter (keys on X-Real-IP instead)");

  await verifyClaimingUnclaimedAdmin();

  console.log(`Gateway auth smoke test passed using ${started.url}`);
} finally {
  if (memberUserId) {
    await db("sessions").where({ user_id: memberUserId }).del();
    await db("tokens").where({ user_id: memberUserId }).del();
    await db("users").where({ id: memberUserId }).del();
  }
  await db("tokens").where({ email: memberEmail }).del();
  if (adminUserId) {
    await db("sessions").where({ user_id: adminUserId }).del();
    await db("tokens").where({ user_id: adminUserId }).del();
    await db("users").where({ id: adminUserId }).del();
  }
  await started.stop();
  await service.close();
}

// Runs entirely inside one transaction that's always rolled back at the end
// (even on success), so it can freely seed/inspect "no claimed admin exists"
// state without touching real data — the live DB always has real users.
async function verifyClaimingUnclaimedAdmin(): Promise<void> {
  const rollbackMarker = {};
  await db
    .transaction(async (trx) => {
      // Every other claimed admin (real prod data, plus this script's own
      // adminUserId seeded earlier and not yet cleaned up) must not leak
      // into this check — demote them for the lifetime of this transaction
      // only, restored by the rollback at the end.
      await trx("users").where({ role: "admin" }).whereNotNull("password_hash").update({ role: "member" });

      const unclaimedEmail = `gateway-auth-smoke-unclaimed-${unique}@example.test`;
      const unclaimedId = randomUUID();
      const now = new Date();
      await trx("users").insert({
        id: unclaimedId,
        email: unclaimedEmail,
        password_hash: null,
        email_verified_at: now,
        totp_enabled: false,
        role: "admin",
        status: "active",
        created_at: now,
        updated_at: now
      });

      const scopedAuth = createAuthFacade(trx);
      const statusBefore = await scopedAuth.bootstrapStatus();
      assert(!statusBefore.adminExists, "An admin row with no password_hash must not count as adminExists=true.");

      const result = await scopedAuth.bootstrapFirstAdmin(unclaimedEmail, "claimed-password-1", {});
      assert(result.status === "session", "bootstrapFirstAdmin should issue a session for the claimed admin.");
      assert(
        result.status === "session" && result.user.id === unclaimedId,
        "bootstrapFirstAdmin should claim the existing unclaimed admin row (same id), not insert a duplicate."
      );

      const claimedRow = await trx("users").where({ id: unclaimedId }).first();
      assert(claimedRow.password_hash, "password_hash should be set on the claimed row.");
      console.log(
        "ok - auth bootstrap claims an existing CLI-created unclaimed admin instead of erroring on duplicate email"
      );

      throw rollbackMarker;
    })
    .catch((error: unknown) => {
      if (error !== rollbackMarker) {
        throw error;
      }
    });
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
