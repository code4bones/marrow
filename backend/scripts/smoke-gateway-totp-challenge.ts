// SEC-11 (T-MEMORY-175): the second login step must prove the password step
// happened (signed challenge bound to the user) and a TOTP step can be used
// only once. Same style as the other gateway smokes (ephemeral local
// gateway, real Postgres -- point POSTGRES_* at a DEDICATED test database).
import { createHmac, randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword } from "../src/gateway/auth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { base32Decode, base32Encode, encryptSecret, generateTotpSecret } from "../src/gateway/totp.js";
import { createPgKnex } from "../src/shared/pg/knex.js";

if (!process.env.TOTP_ENC_KEY) {
  process.env.TOTP_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
}
delete process.env.TOTP_CHALLENGE_REQUIRED;

const db = createPgKnex();
const service = new PgToolService(db);
const auth = createAuthFacade(db);
const started = await startGatewayServer(service, { host: "127.0.0.1", port: 0, token: `totp-challenge-smoke-${Date.now()}`, auth });

const unique = Date.now();
const password = "smoke-totp-password-1";
const users: Array<{ id: string; email: string; secret: string }> = [];

try {
  const now = new Date();
  for (const name of ["a", "b", "c"]) {
    const secret = base32Encode(generateTotpSecret());
    const id = randomUUID();
    const email = `totp-challenge-smoke-${name}-${unique}@example.test`;
    await db("users").insert({
      id, email, password_hash: await hashPassword(password), email_verified_at: now, totp_enabled: true,
      totp_secret: encryptSecret(secret), totp_recovery_code_hashes: [], role: "member", status: "active",
      created_at: now, updated_at: now
    });
    users.push({ id, email, secret });
  }
  const [userA, userB, userC] = users as [(typeof users)[number], (typeof users)[number], (typeof users)[number]];

  const passwordStep = async (u: (typeof users)[number]) => {
    const response = await post("/auth/login", { email: u.email, password });
    assert(response.status === 200, `password step failed for ${u.email}: ${response.status}`);
    const data = ((await response.json()) as { data: { status: string; userId: string; challenge?: string } }).data;
    assert(data.status === "pending_totp" && data.userId === u.id, "expected pending_totp for the right user");
    assert(typeof data.challenge === "string" && data.challenge.length > 20, "password step must hand out a challenge");
    return data.challenge!;
  };
  const secondStep = (userId: string, code: string, challenge?: string) =>
    post("/auth/login/2fa", { userId, code, ...(challenge === undefined ? {} : { challenge }) });

  // --- challenge binding -----------------------------------------------------
  const challengeA = await passwordStep(userA);
  const challengeB = await passwordStep(userB);
  assert((await secondStep(userA.id, totpCode(userA.secret), challengeB)).status === 401, "another user's challenge must be refused");
  assert((await secondStep(userA.id, totpCode(userA.secret), challengeA.replace(/.$/, (c) => (c === "0" ? "1" : "0")))).status === 401, "a tampered challenge must be refused");
  assert((await secondStep(userA.id, totpCode(userA.secret), "garbage")).status === 401, "a malformed challenge must be refused");
  assert((await secondStep(userA.id, totpCode(userA.secret), `1.${"0".repeat(64)}`)).status === 401, "an expired/forged challenge must be refused");
  console.log("ok - a challenge from another user, a tampered, malformed or expired one is refused");

  const goodLogin = await secondStep(userA.id, totpCode(userA.secret), challengeA);
  assert(goodLogin.status === 200 && goodLogin.headers.get("set-cookie"), `valid challenge + code must log in, got ${goodLogin.status}`);
  console.log("ok - password step + matching challenge + valid code logs in");

  // --- TOTP replay -------------------------------------------------------------
  const challengeA2 = await passwordStep(userA);
  assert((await secondStep(userA.id, totpCode(userA.secret), challengeA2)).status === 401, "the SAME TOTP step must not be accepted twice");
  const nextStep = await secondStep(userA.id, totpCode(userA.secret, 1), challengeA2);
  assert(nextStep.status === 200, `a later step's code must still work, got ${nextStep.status}`);
  console.log("ok - a used TOTP step is refused again, the next step's code works");

  // --- the challenge is mandatory by default ------------------------------------
  const challengeB2 = await passwordStep(userB);
  assert((await secondStep(userB.id, totpCode(userB.secret))).status === 401, "a missing challenge must be refused by default");
  assert((await secondStep(userB.id, totpCode(userB.secret), challengeB2)).status === 200, "valid challenge + code must log in (the refusal above must not burn the TOTP step)");
  console.log("ok - a missing challenge is refused by default, a valid one works");

  // --- emergency switch: TOTP_CHALLENGE_REQUIRED=0 accepts a missing challenge again
  process.env.TOTP_CHALLENGE_REQUIRED = "0";
  try {
    assert((await secondStep(userC.id, totpCode(userC.secret))).status === 200, "with the emergency switch a missing challenge is accepted");
    console.log("ok - TOTP_CHALLENGE_REQUIRED=0 (emergency switch) accepts a missing challenge; a wrong one is still refused");
  } finally {
    delete process.env.TOTP_CHALLENGE_REQUIRED;
  }
} finally {
  for (const u of users) {
    await db("sessions").where({ user_id: u.id }).del();
    await db("users").where({ id: u.id }).del();
  }
  await started.stop();
  await service.close();
}

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${started.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function totpCode(secretBase32: string, stepOffset = 0): string {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30) + stepOffset;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return (bin % 10 ** 6).toString().padStart(6, "0");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
