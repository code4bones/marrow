import { createHash } from "node:crypto";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { AppError } from "../shared/errors.js";

export interface GitlabOidcUser { issuer: string; subject: string; username: string | null }
interface Metadata { issuer: string; authorization: string; token: string; jwks: string }

function httpsUrl(value: string | undefined): URL {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    return url;
  } catch { throw new AppError("VALIDATION_ERROR", "GitLab sign-in requires valid HTTPS issuer and callback URLs."); }
}

export function gitlabConfig() {
  const issuerUrl = httpsUrl(process.env.GITLAB_OAUTH_ISSUER?.trim());
  if (issuerUrl.pathname !== "/") throw new AppError("VALIDATION_ERROR", "GitLab issuer must be an HTTPS origin.");
  const callback = httpsUrl(process.env.GITLAB_OAUTH_CALLBACK?.trim());
  if (!callback.pathname.endsWith("/auth/oauth/gitlab/callback")) {
    throw new AppError("VALIDATION_ERROR", "GitLab OAuth callback path is not supported.");
  }
  const clientId = process.env.GITLAB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = (process.env.GITLAB_OAUTH_SECRET ?? process.env.GITLAB_OAUTH_CLIENT_SECRET)?.trim();
  if (!clientId || !clientSecret) throw new AppError("VALIDATION_ERROR", "GitLab sign-in is not configured.");
  return { issuer: issuerUrl.origin, callback: callback.href, clientId, clientSecret };
}

// Domain-separated from the public PKCE challenge; the random verifier remains server-side.
export const gitlabNonce = (verifier: string): string => createHash("sha256").update("marrow:gitlab:nonce:").update(verifier).digest("base64url");

export function createGitlabOidcClient(httpFetch: typeof fetch = fetch) {
  let cached: { metadata: Metadata; expires: number; keys: ReturnType<typeof createRemoteJWKSet> } | undefined;
  const safeFetch: typeof fetch = (url, init) => httpFetch(url, {
    ...init, redirect: "error", credentials: "omit", signal: AbortSignal.timeout(8000)
  });

  async function json(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const response = await safeFetch(url, init);
    if (!response.ok) throw new AppError("VALIDATION_ERROR", "GitLab sign-in service rejected the request.");
    const reader = response.body?.getReader();
    if (!reader) throw new AppError("VALIDATION_ERROR", "GitLab sign-in service returned an invalid response.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 65536) throw new Error("Response too large");
        chunks.push(value);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid response");
      return data as Record<string, unknown>;
    } catch { throw new AppError("VALIDATION_ERROR", "GitLab sign-in service returned an invalid response."); }
    finally { await reader.cancel(); }
  }

  async function discover(issuer: string) {
    if (cached?.metadata.issuer === issuer && cached.expires > Date.now()) return cached;
    const data = await json(`${issuer}/.well-known/openid-configuration`);
    if (data.issuer !== issuer) throw new AppError("VALIDATION_ERROR", "GitLab discovery issuer mismatch.");
    const endpoint = (key: string): string => {
      const url = httpsUrl(typeof data[key] === "string" ? data[key] : undefined);
      if (url.origin !== issuer) throw new AppError("VALIDATION_ERROR", "GitLab discovery endpoint is not trusted.");
      return url.href;
    };
    const metadata = { issuer, authorization: endpoint("authorization_endpoint"), token: endpoint("token_endpoint"), jwks: endpoint("jwks_uri") };
    cached = {
      metadata, expires: Date.now() + 600_000,
      keys: createRemoteJWKSet(new URL(metadata.jwks), { [customFetch]: safeFetch, timeoutDuration: 8000 })
    };
    return cached;
  }

  return {
    async authorizeUrl(state: string, challenge: string, nonce: string): Promise<string> {
      const config = gitlabConfig();
      const { metadata } = await discover(config.issuer);
      const url = new URL(metadata.authorization);
      for (const [key, value] of Object.entries({
        client_id: config.clientId, redirect_uri: config.callback, response_type: "code",
        scope: "openid profile email", state, nonce, code_challenge: challenge, code_challenge_method: "S256"
      })) url.searchParams.set(key, value);
      return url.href;
    },
    async resolveUser(code: string, verifier: string, expectedIssuer: string): Promise<GitlabOidcUser> {
      const config = gitlabConfig();
      if (expectedIssuer !== config.issuer) throw new AppError("VALIDATION_ERROR", "GitLab issuer changed during sign-in.");
      const { metadata, keys } = await discover(config.issuer);
      const body = await json(metadata.token, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.callback,
          client_id: config.clientId, client_secret: config.clientSecret, code_verifier: verifier })
      });
      if (typeof body.id_token !== "string") throw new AppError("VALIDATION_ERROR", "GitLab did not return an identity token.");
      const { payload } = await jwtVerify(body.id_token, keys, {
        issuer: config.issuer, audience: config.clientId, algorithms: ["RS256"], requiredClaims: ["exp", "iat", "sub", "nonce"], maxTokenAge: "10m"
      });
      if (payload.nonce !== gitlabNonce(verifier) || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255 ||
          (payload.azp !== undefined && payload.azp !== config.clientId) ||
          (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== config.clientId)) {
        throw new AppError("VALIDATION_ERROR", "GitLab identity token was not issued for this sign-in.");
      }
      return { issuer: config.issuer, subject: payload.sub,
        username: typeof payload.preferred_username === "string" ? payload.preferred_username.slice(0, 255) : null };
    }
  };
}

export const gitlabOidc = createGitlabOidcClient();
