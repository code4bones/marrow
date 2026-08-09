// GitHub OAuth sign-in (Marrow as the OAuth *client* this time -- the
// opposite direction from oauth.ts, where Marrow is the authorization
// server for MCP connectors). GITHUB_OAUTH_CLIENT_ID/_SECRET are already
// staged in prod (see D-MEMORY-... handoff); this is the code path that
// actually uses them.
import { AppError } from "../shared/errors.js";

export interface GithubUser {
  githubId: string;
  login: string;
  email: string;
}

/** Same injectable-fetch seam as git-credentials.ts's GitHttpFetch -- lets a smoke test substitute a fake instead of hitting github.com. */
export type GithubHttpFetch = typeof fetch;

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new AppError(
      "VALIDATION_ERROR",
      "GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET must be set to enable GitHub sign-in."
    );
  }
  return { clientId, clientSecret };
}

export function githubAuthorizeUrl(state: string, redirectUri: string): string {
  const { clientId } = credentials();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "read:user user:email");
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  httpFetch: GithubHttpFetch
): Promise<string> {
  const { clientId, clientSecret } = credentials();
  const response = await httpFetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri })
  });
  if (!response.ok) {
    throw new AppError("VALIDATION_ERROR", `GitHub token exchange failed with HTTP ${response.status}.`);
  }
  const body = (await response.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) {
    throw new AppError("VALIDATION_ERROR", body.error_description ?? "GitHub did not return an access token.");
  }
  return body.access_token;
}

async function fetchPrimaryVerifiedEmail(accessToken: string, httpFetch: GithubHttpFetch): Promise<string> {
  const response = await httpFetch("https://api.github.com/user/emails", {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json" }
  });
  if (!response.ok) {
    throw new AppError("VALIDATION_ERROR", `GitHub email lookup failed with HTTP ${response.status}.`);
  }
  const emails = (await response.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
  const primary = emails.find((entry) => entry.primary && entry.verified) ?? emails.find((entry) => entry.verified);
  if (!primary) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Your GitHub account has no verified email address. Verify an email on GitHub and try again."
    );
  }
  return primary.email;
}

/** Full code -> {githubId, login, verified email} exchange. Doesn't touch the database -- callers decide what a matched/new identity means. */
export async function resolveGithubUser(
  code: string,
  redirectUri: string,
  httpFetch: GithubHttpFetch = fetch
): Promise<GithubUser> {
  const accessToken = await exchangeCodeForToken(code, redirectUri, httpFetch);
  const userResponse = await httpFetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json" }
  });
  if (!userResponse.ok) {
    throw new AppError("VALIDATION_ERROR", `GitHub user lookup failed with HTTP ${userResponse.status}.`);
  }
  const user = (await userResponse.json()) as { id: number; login: string; email: string | null };
  const email = user.email ?? (await fetchPrimaryVerifiedEmail(accessToken, httpFetch));
  return { githubId: String(user.id), login: user.login, email };
}
