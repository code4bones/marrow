import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { bindingCookieName, startOAuthBinding, verifyOAuthBinding } from "../src/gateway/oauth-state-binding.js";

// T-MEMORY-175: login-CSRF -- a callback URL alone must not be enough.
beforeAll(() => {
  process.env.TOTP_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
});

function cookiesFrom(setCookie: string | null): Record<string, string> {
  if (!setCookie) return {};
  const [pair] = setCookie.split(";");
  const index = pair.indexOf("=");
  return { [pair.slice(0, index)]: pair.slice(index + 1) };
}

describe("OAuth state binding", () => {
  const raw = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCde";

  it("start sets a per-state HttpOnly/Lax cookie and signs the state with it", () => {
    const { state, setCookie } = startOAuthBinding(raw, true);
    expect(state.startsWith(`${raw}.`)).toBe(true);
    expect(state).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{32}$/);
    expect(setCookie).toContain(`${bindingCookieName(raw)}=`);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Max-Age=600/);
    expect(setCookie).toMatch(/Secure/);
    expect(startOAuthBinding(raw, false).setCookie).not.toMatch(/Secure/);
  });

  it("accepts the state together with the cookie that started it", () => {
    const { state, setCookie } = startOAuthBinding(raw, false);
    const result = verifyOAuthBinding(state, cookiesFrom(setCookie));
    expect(result).toEqual({ ok: true, raw, legacy: false });
  });

  it("refuses the state without the cookie (the CSRF case: a URL handed to someone else)", () => {
    const { state } = startOAuthBinding(raw, false);
    expect(verifyOAuthBinding(state, {})).toMatchObject({ ok: false, reason: "missing_cookie", raw });
  });

  it("refuses a cookie with the wrong nonce, another flow's cookie, and a tampered signature", () => {
    const first = startOAuthBinding(raw, false);
    const other = startOAuthBinding("OtherStateOtherStateOtherStateOtherStat1", false);
    // right cookie NAME, nonce from a different flow
    const wrongNonce = { [bindingCookieName(raw)]: Object.values(cookiesFrom(other.setCookie))[0] };
    expect(verifyOAuthBinding(first.state, wrongNonce)).toMatchObject({ ok: false, reason: "bad_signature" });
    // the other flow's cookie under ITS name does not help this state
    expect(verifyOAuthBinding(first.state, cookiesFrom(other.setCookie))).toMatchObject({ ok: false, reason: "missing_cookie" });
    // tampered signature
    const tampered = first.state.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    expect(verifyOAuthBinding(tampered, cookiesFrom(first.setCookie))).toMatchObject({ ok: false, reason: "bad_signature" });
    // malformed signature part
    expect(verifyOAuthBinding(`${raw}.zzz`, cookiesFrom(first.setCookie))).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("parallel sign-ins do not clobber each other (one cookie per state)", () => {
    const a = startOAuthBinding("StateAStateAStateAStateAStateAStateAStateA12", false);
    const b = startOAuthBinding("StateBStateBStateBStateBStateBStateBStateB12", false);
    expect(bindingCookieName("StateAStateAStateAStateAStateAStateAStateA12")).not.toBe(bindingCookieName("StateBStateBStateBStateBStateBStateBStateB12"));
    const jar = { ...cookiesFrom(a.setCookie), ...cookiesFrom(b.setCookie) };
    expect(verifyOAuthBinding(a.state, jar).ok).toBe(true);
    expect(verifyOAuthBinding(b.state, jar).ok).toBe(true);
  });

  it("still accepts a legacy (unsigned) state issued before this shipped", () => {
    expect(verifyOAuthBinding(raw, {})).toEqual({ ok: true, raw, legacy: true });
  });

  it("skips the binding when no key can be derived, instead of breaking sign-in", () => {
    const saved = process.env.TOTP_ENC_KEY;
    delete process.env.TOTP_ENC_KEY;
    try {
      expect(startOAuthBinding(raw, false)).toEqual({ state: raw, setCookie: null });
    } finally {
      process.env.TOTP_ENC_KEY = saved;
    }
  });
});
