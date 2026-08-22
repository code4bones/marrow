// T-MEMORY-093 correction: Telegram retired the old HMAC-signed Login
// Widget (oauth.telegram.org/auth's classic embed now serves "deprecated")
// in favor of real OpenID Connect -- Authorization Code + PKCE, client_id/
// client_secret issued per-bot from BotFather's "Login Widget" panel
// (distinct from the bot token itself). This mirrors github-oauth.ts's
// shape as closely as OIDC allows; the real difference is Telegram hands
// back a signed id_token (verified against its own JWKS) instead of a
// separate "fetch the user" API call.
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { AppError } from "../shared/errors.js";

const AUTH_ENDPOINT = "https://oauth.telegram.org/auth";
const TOKEN_ENDPOINT = "https://oauth.telegram.org/token";
const JWKS_URL = "https://oauth.telegram.org/.well-known/jwks.json";

// oauth.telegram.org is Telegram-owned, same as api.telegram.org (which
// TELEGRAM_BOT_PROXY exists for -- confirmed live, direct requests to it
// time out from this network). Node's native fetch (undici-backed) does
// NOT automatically honor HTTP_PROXY/HTTPS_PROXY env vars the way curl
// does, so both the token exchange below and jose's own JWKS fetch need
// this dispatcher explicitly, not just grammY's node-fetch-based bot client.
function proxyDispatcher(): ProxyAgent | undefined {
  const proxyUrl = process.env.TELEGRAM_BOT_PROXY?.trim();
  return proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
}

const proxiedFetch: typeof fetch = async (input, init) => {
  const dispatcher = proxyDispatcher();
  const result = await undiciFetch(input as string, dispatcher ? { ...init, dispatcher } : (init as Record<string, unknown>));
  return result as unknown as Response;
};

// Module-level: createRemoteJWKSet caches Telegram's public keys internally
// (refetching only on an unknown `kid`), same "don't rebuild per request"
// reasoning as telegram.ts's memoized Api instance.
const jwksOptions: Record<PropertyKey, unknown> = { [customFetch]: proxiedFetch };
const jwks = createRemoteJWKSet(new URL(JWKS_URL), jwksOptions as Parameters<typeof createRemoteJWKSet>[1]);

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.TELEGRAM_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.TELEGRAM_OAUTH_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new AppError(
      "VALIDATION_ERROR",
      "TELEGRAM_OAUTH_CLIENT_ID / TELEGRAM_OAUTH_SECRET must be set to enable Telegram sign-in."
    );
  }
  return { clientId, clientSecret };
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function telegramAuthorizeUrl(state: string, codeChallenge: string, redirectUri: string): string {
  const { clientId } = credentials();
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface TelegramOidcUser {
  telegramId: string;
  username: string | null;
  firstName: string | null;
}

/** Same injectable-fetch seam as github-oauth.ts's GithubHttpFetch -- lets a smoke test substitute a fake instead of hitting oauth.telegram.org. */
export type TelegramHttpFetch = typeof fetch;

/** Exported for verification only -- lets a throwaway script confirm the proxy dispatcher actually reaches oauth.telegram.org before anything depends on it in production. */
export { proxiedFetch as telegramProxiedFetch };

export async function resolveTelegramUser(
  code: string,
  redirectUri: string,
  codeVerifier: string,
  httpFetch: TelegramHttpFetch = proxiedFetch
): Promise<TelegramOidcUser> {
  const { clientId, clientSecret } = credentials();
  const response = await httpFetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: codeVerifier
    })
  });
  if (!response.ok) {
    throw new AppError("VALIDATION_ERROR", `Telegram token exchange failed with HTTP ${response.status}.`);
  }
  const body = (await response.json()) as { id_token?: string; error_description?: string };
  if (!body.id_token) {
    throw new AppError("VALIDATION_ERROR", body.error_description ?? "Telegram did not return an id_token.");
  }

  const { payload } = await jwtVerify(body.id_token, jwks, { audience: clientId });
  // `sub` is a separate, long OIDC subject identifier -- NOT the raw
  // Telegram user id (confirmed live: it doesn't match message.from.id from
  // the Bot API, so the bot could never find the identity this created).
  // `id` (added by the `profile` scope) is the actual numeric Telegram user
  // id, the same one the Bot API uses -- that's what's needed both to
  // recognize a /start sender and to sendMessage() them later.
  const idClaim = payload.id;
  if (typeof idClaim !== "number" && typeof idClaim !== "string") {
    throw new AppError("VALIDATION_ERROR", "Telegram id_token is missing the numeric id claim.");
  }
  return {
    telegramId: String(idClaim),
    username: firstStringClaim(payload, ["preferred_username"]),
    firstName: firstStringClaim(payload, ["given_name", "name"])
  };
}

function firstStringClaim(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}
