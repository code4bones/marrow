import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AuthFacade, type SessionIdentity } from "../src/gateway/auth.js";
import { handleGitlabAuthRoute } from "../src/gateway/gitlab-auth-routes.js";
import { gitlabOidc } from "../src/gateway/gitlab-oidc.js";
import { startOAuthBinding } from "../src/gateway/oauth-state-binding.js";

let server: Server;
let base: string;
let session: SessionIdentity | null;
let auth: Parameters<typeof handleGitlabAuthRoute>[0]["auth"];
const active: SessionIdentity = { userId: "one", sessionId: "browser-session", email: "alice@example.test", role: "member", status: "active", totpEnabled: true };
const rawState = "TestStateTestStateTestStateTestStateTestState123";
const issuer = "https://gitlab.example.test";
const identity = { issuer, subject: "42", username: "alice" };
beforeEach(async () => {
  vi.stubEnv("GITLAB_OAUTH_ISSUER", issuer);
  vi.stubEnv("GITLAB_OAUTH_CLIENT_ID", "client");
  vi.stubEnv("GITLAB_OAUTH_SECRET", "secret");
  vi.stubEnv("GITLAB_OAUTH_CALLBACK", "https://marrow.example.test/api/auth/oauth/gitlab/callback");
  vi.stubEnv("TOTP_ENC_KEY", Buffer.alloc(32, 1).toString("base64"));
  session = null;
  auth = {
    gitlabLinkStatus: vi.fn<AuthFacade["gitlabLinkStatus"]>().mockResolvedValue({ linked: false, username: null, issuer }),
    unlinkGitlabIdentity: vi.fn<AuthFacade["unlinkGitlabIdentity"]>().mockResolvedValue(),
    mintOAuthState: vi.fn<AuthFacade["mintOAuthState"]>().mockResolvedValue(rawState),
    consumeOAuthState: vi.fn<AuthFacade["consumeOAuthState"]>().mockResolvedValue({ intent: "login", userId: null, returnTo: null, codeVerifier: "verifier", issuer }),
    linkGitlabIdentity: vi.fn<AuthFacade["linkGitlabIdentity"]>().mockResolvedValue(),
    loginViaGitlab: vi.fn<AuthFacade["loginViaGitlab"]>().mockResolvedValue({ status: "session", token: "issued-token", user: { id: "one", email: active.email, role: "member" } })
  };
  vi.spyOn(gitlabOidc, "authorizeUrl").mockResolvedValue(`${issuer}/oauth/authorize`);
  vi.spyOn(gitlabOidc, "resolveUser").mockResolvedValue(identity);
  server = createServer((request, response) => {
    const requestUrl = new URL(request.url!, base);
    void handleGitlabAuthRoute({ auth, request, response, requestUrl, requestPath: requestUrl.pathname, sessionAuth: session,
      send: (status, body) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); }
    }).then(handled => { if (!handled) { response.writeHead(404); response.end(); } }).catch(() => { response.writeHead(500); response.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.restoreAllMocks(); vi.unstubAllEnvs();
});
function callback(cookie = true) {
  const binding = startOAuthBinding(rawState, false);
  return fetch(`${base}/auth/oauth/gitlab/callback?code=provider-code&state=${encodeURIComponent(binding.state)}`, {
    redirect: "manual", headers: cookie && binding.setCookie ? { cookie: binding.setCookie.split(";")[0] } : {}
  });
}
describe("GitLab browser authorization routes", () => {
  it("requires an active browser session for profile and link start", async () => {
    expect((await fetch(`${base}/auth/profile/gitlab`)).status).toBe(401);
    expect((await fetch(`${base}/auth/oauth/gitlab/start?intent=link`)).status).toBe(401);
    expect(auth.mintOAuthState).not.toHaveBeenCalled();
    session = { ...active, status: "disabled" };
    expect((await fetch(`${base}/auth/profile/gitlab`)).status).toBe(401);
  });
  it("binds link state to the signed-in user, provider, issuer and browser cookie", async () => {
    session = active;
    const response = await fetch(`${base}/auth/oauth/gitlab/start?intent=link`, { redirect: "manual", headers: { "x-forwarded-proto": "https" } });
    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly.*SameSite=Lax.*Secure/);
    expect(auth.mintOAuthState).toHaveBeenCalledWith("link", "one", null, expect.any(String), "gitlab", issuer);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("fails closed if browser binding is unavailable and reuses an active Marrow session", async () => {
    vi.stubEnv("TOTP_ENC_KEY", "");
    expect((await fetch(`${base}/auth/oauth/gitlab/start`, { redirect: "manual" })).status).toBe(503);
    expect(gitlabOidc.authorizeUrl).not.toHaveBeenCalled();
    session = active;
    const response = await fetch(`${base}/auth/oauth/gitlab/start`, { redirect: "manual" });
    expect(response.headers.get("location")).toBe("/projects");
  });
  it("rejects handed-off callback URLs without the original browser cookie", async () => {
    const response = await callback(false);
    expect(response.headers.get("location")).toMatch(/^\/login\?error=/);
    expect(auth.consumeOAuthState).not.toHaveBeenCalled();
    expect(gitlabOidc.resolveUser).not.toHaveBeenCalled();
  });
  it("rejects legacy unsigned states", async () => {
    await fetch(`${base}/auth/oauth/gitlab/callback?code=code&state=${rawState}`, { redirect: "manual" });
    expect(auth.consumeOAuthState).not.toHaveBeenCalled();
  });
  it("verifies identity before issuing an HttpOnly session, without OAuth tokens in redirects", async () => {
    const response = await callback();
    expect(auth.consumeOAuthState).toHaveBeenCalledWith(rawState, "gitlab");
    expect(gitlabOidc.resolveUser).toHaveBeenCalledWith("provider-code", "verifier", issuer);
    expect(response.headers.get("location")).toBe("/projects");
    expect(response.headers.get("set-cookie")).toMatch(/marrow_session=issued-token;.*HttpOnly/);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("requires the same active Marrow user on a link callback", async () => {
    vi.mocked(auth.consumeOAuthState).mockResolvedValue({ intent: "link", userId: "one", returnTo: null, codeVerifier: "verifier", issuer });
    session = { ...active, userId: "two" };
    const response = await callback();
    expect(response.headers.get("location")).toMatch(/^\/profile\?gitlabError=/);
    expect(gitlabOidc.resolveUser).not.toHaveBeenCalled();
    expect(auth.linkGitlabIdentity).not.toHaveBeenCalled();
  });
  it("links the verified identity and does not log in a different account", async () => {
    session = active;
    vi.mocked(auth.consumeOAuthState).mockResolvedValue({ intent: "link", userId: "one", returnTo: null, codeVerifier: "verifier", issuer });
    expect((await callback()).headers.get("location")).toBe("/profile?gitlabLinked=1");
    expect(auth.linkGitlabIdentity).toHaveBeenCalledWith("one", identity);
    expect(auth.loginViaGitlab).not.toHaveBeenCalled();
  });
  it("does not auto-register unlinked identities and hides provider failures", async () => {
    vi.mocked(auth.loginViaGitlab).mockResolvedValue({ status: "not_linked" });
    const unlinked = await callback();
    expect(unlinked.headers.get("location")).toContain("not%20linked");
    expect(unlinked.headers.get("set-cookie")).not.toContain("marrow_session");
    vi.mocked(gitlabOidc.resolveUser).mockRejectedValue(new Error("sensitive-provider-details"));
    const failed = await callback();
    expect(failed.headers.get("location")).not.toContain("sensitive-provider-details");
  });
  it("requires a same-origin authenticated POST to unlink", async () => {
    session = active;
    const path = `${base}/auth/profile/gitlab/unlink`;
    expect((await fetch(path, { method: "POST" })).status).toBe(403);
    expect((await fetch(path, { method: "POST", headers: { origin: "https://evil.example.test" } })).status).toBe(403);
    expect(auth.unlinkGitlabIdentity).not.toHaveBeenCalled();
    expect((await fetch(path, { method: "POST", headers: { origin: "https://marrow.example.test" } })).status).toBe(200);
    expect(auth.unlinkGitlabIdentity).toHaveBeenCalledWith("one", issuer);
  });
});
