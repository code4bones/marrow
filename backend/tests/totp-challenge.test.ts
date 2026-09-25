import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { issueTotpChallenge, totpChallengeRequired, verifyTotpChallenge } from "../src/gateway/totp-challenge.js";
import { base32Encode, generateTotpSecret, verifyTotpCode, verifyTotpCodeStep } from "../src/gateway/totp.js";

// T-MEMORY-175: the second login step must prove the password step happened.
beforeAll(() => {
  process.env.TOTP_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
});

describe("totp challenge", () => {
  const user = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";

  it("verifies for the user it was issued to, until it expires", () => {
    const now = 1_800_000_000_000;
    const challenge = issueTotpChallenge(user, now);
    expect(verifyTotpChallenge(user, challenge, now + 1000)).toBe(true);
    expect(verifyTotpChallenge(user, challenge, now + 5 * 60 * 1000 - 1)).toBe(true);
    expect(verifyTotpChallenge(user, challenge, now + 5 * 60 * 1000 + 1)).toBe(false);
  });

  it("is bound to the user and tamper-proof", () => {
    const now = 1_800_000_000_000;
    const challenge = issueTotpChallenge(user, now);
    expect(verifyTotpChallenge(other, challenge, now)).toBe(false);
    const [expires, mac] = challenge.split(".");
    expect(verifyTotpChallenge(user, `${Number(expires) + 60_000}.${mac}`, now)).toBe(false); // longer lifetime, same mac
    expect(verifyTotpChallenge(user, `${expires}.${"0".repeat(64)}`, now)).toBe(false);
    expect(verifyTotpChallenge(user, "", now)).toBe(false);
    expect(verifyTotpChallenge(user, "not-a-challenge", now)).toBe(false);
    expect(verifyTotpChallenge(user, `${expires}.${mac.toUpperCase()}`, now)).toBe(false);
  });

  it("is only mandatory when TOTP_CHALLENGE_REQUIRED=1", () => {
    delete process.env.TOTP_CHALLENGE_REQUIRED;
    expect(totpChallengeRequired()).toBe(false);
    process.env.TOTP_CHALLENGE_REQUIRED = "1";
    expect(totpChallengeRequired()).toBe(true);
    delete process.env.TOTP_CHALLENGE_REQUIRED;
  });
});

describe("verifyTotpCodeStep", () => {
  it("returns the matching step (or null) and stays consistent with verifyTotpCode", () => {
    const secret = base32Encode(generateTotpSecret());
    expect(verifyTotpCodeStep(secret, "abcdef")).toBeNull();
    expect(verifyTotpCodeStep(secret, "12345")).toBeNull();
    expect(verifyTotpCode(secret, "000000")).toBe(verifyTotpCodeStep(secret, "000000") !== null);
  });
});
