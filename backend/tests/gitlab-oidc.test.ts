import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createGitlabOidcClient, gitlabConfig, gitlabNonce } from "../src/gateway/gitlab-oidc.js";
import { generatePkce } from "../src/gateway/oauth-pkce.js";

const issuer = "https://gitlab.example.test";
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  pair = await generateKeyPair("RS256");
  jwk = { ...await exportJWK(pair.publicKey), kid: "gitlab-test", alg: "RS256", use: "sig" };
});
beforeEach(() => {
  vi.stubEnv("GITLAB_OAUTH_ISSUER", issuer);
  vi.stubEnv("GITLAB_OAUTH_CLIENT_ID", "marrow-client");
  vi.stubEnv("GITLAB_OAUTH_SECRET", "test-secret-never-in-browser");
  vi.stubEnv("GITLAB_OAUTH_CALLBACK", "https://marrow.example.test/api/auth/oauth/gitlab/callback");
});
afterEach(() => vi.unstubAllEnvs());

async function setup(overrides: JWTPayload = {}, metadata: Record<string, unknown> = {}, signingPair = pair) {
  const { verifier, challenge } = generatePkce();
  const token = await new SignJWT({ nonce: gitlabNonce(verifier), preferred_username: "alice", ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "gitlab-test" }).setIssuer(String(overrides.iss ?? issuer))
    .setAudience(overrides.aud ?? "marrow-client").setSubject(String(overrides.sub ?? "42"))
    .setIssuedAt(Number(overrides.iat ?? Math.floor(Date.now() / 1000)))
    .setExpirationTime(overrides.exp ?? "5m").sign(signingPair.privateKey);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input); calls.push({ url, init });
    if (url.endsWith("openid-configuration")) return Response.json({ issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, jwks_uri: `${issuer}/oauth/keys`, ...metadata });
    if (url.endsWith("/oauth/token")) return Response.json({ id_token: token, access_token: "unused", refresh_token: "unused" });
    if (url.endsWith("/oauth/keys")) return Response.json({ keys: [jwk] });
    throw new Error("Unexpected request");
  });
  return { client: createGitlabOidcClient(fakeFetch), verifier, challenge, calls, fakeFetch };
}

describe("GitLab OIDC trust boundary", () => {
  it("uses S256 and nonce without exposing the secret or verifier in the browser", async () => {
    const test = await setup();
    const url = new URL(await test.client.authorizeUrl("signed-state", test.challenge, gitlabNonce(test.verifier)));
    expect(url.origin).toBe(issuer);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("nonce")).not.toBe(test.challenge);
    expect(url.href).not.toContain("test-secret");
    expect(url.href).not.toContain(test.verifier);
    expect(await test.client.resolveUser("code", test.verifier, issuer)).toEqual({ issuer, subject: "42", username: "alice" });
    const exchange = test.calls.find(call => call.url.endsWith("/oauth/token"))!;
    const body = exchange.init?.body as URLSearchParams;
    expect(body.get("client_secret")).toBe("test-secret-never-in-browser");
    expect(body.get("code_verifier")).toBe(test.verifier);
    expect(test.calls.every(call => call.init?.redirect === "error")).toBe(true);
  });
  it.each([
    { iss: "https://other.example.test" }, { aud: "another-client" }, { nonce: "wrong" },
    { exp: 1 }, { iat: 1 }, { sub: "" }, { azp: "other-client" }, { aud: ["marrow-client", "other-client"] }
  ])("rejects invalid identity claims %j", async claims => {
    const test = await setup(claims);
    await expect(test.client.resolveUser("code", test.verifier, issuer)).rejects.toThrow();
  });
  it("rejects a forged signature", async () => {
    const test = await setup({}, {}, await generateKeyPair("RS256"));
    await expect(test.client.resolveUser("code", test.verifier, issuer)).rejects.toThrow();
  });
  it.each([
    { issuer: "https://other.example.test" }, { token_endpoint: "https://other.example.test/token" },
    { jwks_uri: "http://gitlab.example.test/keys" }, { authorization_endpoint: "https://name:password@gitlab.example.test/authorize" }
  ])("rejects untrusted discovery %j", async metadata => {
    const test = await setup({}, metadata);
    await expect(test.client.authorizeUrl("state", test.challenge, "nonce")).rejects.toThrow();
    expect(test.calls).toHaveLength(1);
  });
  it("refuses issuer changes before exchanging a code", async () => {
    const test = await setup();
    await expect(test.client.resolveUser("code", test.verifier, "https://other.example.test")).rejects.toThrow();
    expect(test.calls).toHaveLength(0);
  });
  it("bounds provider JSON and hides provider error bodies", async () => {
    const client = createGitlabOidcClient(vi.fn<typeof fetch>(async () => new Response("credential-details".repeat(70000))));
    await expect(client.authorizeUrl("state", "challenge", "nonce")).rejects.toThrow("invalid response");
  });
  it("rejects unsafe or incomplete configuration", () => {
    vi.stubEnv("GITLAB_OAUTH_ISSUER", "http://gitlab.example.test");
    expect(gitlabConfig).toThrow();
    vi.stubEnv("GITLAB_OAUTH_ISSUER", issuer);
    vi.stubEnv("GITLAB_OAUTH_CALLBACK", "https://marrow.example.test/callback?redirect=evil");
    expect(gitlabConfig).toThrow();
  });
});
