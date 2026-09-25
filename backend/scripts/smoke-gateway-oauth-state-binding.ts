// SEC-11 (T-MEMORY-175): login-CSRF on the GitHub / Telegram sign-in. The
// callback must need BOTH the state and the cookie /start set in the browser
// that began the flow. Same style as the other gateway smokes (ephemeral local
// gateway, real Postgres -- point POSTGRES_* at a DEDICATED test database).
// Provider credentials are fake; the only outbound calls are the "positive"
// callbacks' token exchanges, which fail (fake code) AFTER the state check.
import { randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade } from "../src/gateway/auth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";

process.env.TOTP_ENC_KEY ||= Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
process.env.GITHUB_OAUTH_CLIENT_ID = "smoke-github-client";
process.env.GITHUB_OAUTH_CLIENT_SECRET = "smoke-github-secret";
process.env.TELEGRAM_OAUTH_CLIENT_ID = "smoke-telegram-client";
process.env.TELEGRAM_OAUTH_SECRET = "smoke-telegram-secret";
process.env.PROJECT_MEMORY_PUBLIC_URL = "https://pmem-state-binding-smoke.example/api";

const db = createPgKnex();
const service = new PgToolService(db);
const auth = createAuthFacade(db);
const started = await startGatewayServer(service, { host: "127.0.0.1", port: 0, token: `state-binding-smoke-${Date.now()}`, auth });

const NOT_THIS_BROWSER = /did not start in this browser/i;
const STATE_INVALID = /expired or is invalid/i;

try {
  for (const provider of ["github", "telegram"] as const) {
    const start = async () => {
      const response = await fetch(`${started.url}/auth/oauth/${provider}/start`, { redirect: "manual" });
      assert(response.status === 302, `${provider} start should redirect, got ${response.status}`);
      const location = new URL(response.headers.get("location")!);
      const state = location.searchParams.get("state");
      assert(state, `${provider} start: the provider redirect carries no state`);
      const setCookie = response.headers.get("set-cookie");
      return { state: state!, setCookie, cookiePair: setCookie ? setCookie.split(";")[0]! : "" };
    };
    const callback = async (state: string, cookie?: string) => {
      const response = await fetch(`${started.url}/auth/oauth/${provider}/callback?code=fake-code&state=${encodeURIComponent(state)}`, {
        redirect: "manual",
        headers: cookie ? { cookie } : {}
      });
      assert(response.status === 302, `${provider} callback should redirect, got ${response.status}`);
      return decodeURIComponent(response.headers.get("location") ?? "");
    };
    const stateRows = async () => Number((await db("oauth_login_states").count<{ count: string }[]>("id as count").first())?.count ?? 0);

    // --- /start binds the state to the browser ------------------------------------
    const a = await start();
    assert(/^[A-Za-z0-9_-]+\.[0-9a-f]{32}$/.test(a.state), `${provider}: state must be "<raw>.<signature>", got ${a.state}`);
    assert(a.setCookie && /^marrow_oauth_[0-9a-f]{12}=/.test(a.setCookie), `${provider}: /start must set a per-state binding cookie`);
    assert(/HttpOnly/i.test(a.setCookie!) && /SameSite=Lax/i.test(a.setCookie!), `${provider}: the binding cookie must be HttpOnly + SameSite=Lax`);
    const b = await start();
    assert(a.cookiePair.split("=")[0] !== b.cookiePair.split("=")[0], `${provider}: parallel starts must use different cookie names`);
    console.log(`ok - ${provider} start signs the state and sets a per-state HttpOnly/Lax cookie (parallel flows use different cookies)`);

    // --- the CSRF case: the callback URL alone (no cookie) is refused -------------
    const before = await stateRows();
    const noCookie = await callback(a.state);
    assert(NOT_THIS_BROWSER.test(noCookie), `${provider}: a callback without the cookie must be refused, got ${noCookie}`);
    assert((await stateRows()) === before - 1, `${provider}: a refused callback must still burn the state (single use)`);
    console.log(`ok - ${provider} callback without the starting browser's cookie is refused, and the state is burned`);

    // --- wrong cookie / other flow's cookie / tampered signature -----------------
    const c = await start();
    const wrongNonce = `${c.cookiePair.split("=")[0]}=${b.cookiePair.split("=")[1]}`; // right name, nonce of another flow
    assert(NOT_THIS_BROWSER.test(await callback(c.state, wrongNonce)), `${provider}: a cookie with the wrong nonce must be refused`);
    const d = await start();
    assert(NOT_THIS_BROWSER.test(await callback(d.state, b.cookiePair)), `${provider}: another flow's cookie must not authorise this state`);
    const e = await start();
    const tampered = e.state.replace(/.$/, (ch) => (ch === "0" ? "1" : "0"));
    assert(NOT_THIS_BROWSER.test(await callback(tampered, e.cookiePair)), `${provider}: a tampered signature must be refused`);
    console.log(`ok - ${provider} callback refuses a wrong-nonce cookie, another flow's cookie and a tampered signature`);

    // --- positive: the right cookie passes the state check (then fails at the provider, fake code)
    const f = await start();
    const positive = await callback(f.state, f.cookiePair);
    assert(!NOT_THIS_BROWSER.test(positive) && !STATE_INVALID.test(positive), `${provider}: the starting browser must pass the state check, got ${positive}`);
    console.log(`ok - ${provider} callback with the starting browser's cookie passes the state check (proceeds to the provider exchange)`);

    // --- a state issued before this shipped (no signature) still works ---------------
    const legacyRaw = await auth.mintOAuthState("login", null, null, provider === "telegram" ? "legacy-verifier" : null);
    const legacy = await callback(legacyRaw);
    assert(!NOT_THIS_BROWSER.test(legacy) && !STATE_INVALID.test(legacy), `${provider}: a legacy (unsigned) state must still be accepted, got ${legacy}`);
    console.log(`ok - ${provider}: an unsigned state minted before the change still works (in-flight sign-ins are not broken)`);

    // --- an unknown/expired state is still reported as before ------------------------
    const unknown = await callback("totally-unknown-state-value");
    assert(STATE_INVALID.test(unknown), `${provider}: an unknown legacy-shaped state must still say it expired/is invalid, got ${unknown}`);
    console.log(`ok - ${provider}: an unknown state still gets the original "expired or invalid" message`);
  }
} finally {
  await db("oauth_login_states").where("created_at", ">", new Date(Date.now() - 10 * 60 * 1000)).del();
  await started.stop();
  await service.close();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
