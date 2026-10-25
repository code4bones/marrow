import type { IncomingMessage, ServerResponse } from "node:http";
import { AppError } from "../shared/errors.js";
import { fail } from "../shared/mcp/tool-response.js";
import { isForwardedHttps, parseCookies, sessionCookieHeader, type AuthFacade, type SessionIdentity } from "./auth.js";
import { bindingCookieName, startOAuthBinding, verifyOAuthBinding } from "./oauth-state-binding.js";
import { generatePkce } from "./oauth-pkce.js";
import { gitlabConfig, gitlabNonce, gitlabOidc } from "./gitlab-oidc.js";

interface Context {
  auth: Pick<AuthFacade, "gitlabLinkStatus" | "unlinkGitlabIdentity" | "mintOAuthState" | "consumeOAuthState" | "linkGitlabIdentity" | "loginViaGitlab">;
  request: IncomingMessage;
  response: ServerResponse;
  requestUrl: URL;
  requestPath: string;
  sessionAuth: SessionIdentity | null;
  send(status: number, body: unknown): void;
}

export async function handleGitlabAuthRoute(context: Context): Promise<boolean> {
  const { auth, request, response, requestUrl, requestPath, sessionAuth, send } = context;
  if (!requestPath.startsWith("/auth/oauth/gitlab/") && !requestPath.startsWith("/auth/profile/gitlab")) return false;
  const redirect = (path: string) => { response.writeHead(302, { location: path, "cache-control": "no-store", "referrer-policy": "no-referrer" }); response.end(); };
  const activeSession = sessionAuth?.status === "active" ? sessionAuth : null;

  if (request.method === "GET" && requestPath === "/auth/profile/gitlab") {
    if (!activeSession) { send(401, fail(new AppError("UNAUTHORIZED", "A session is required."))); return true; }
    let config;
    try { config = gitlabConfig(); } catch {
      send(200, { ok: true, data: { enabled: false, linked: false, username: null, issuer: null } });
      return true;
    }
    send(200, { ok: true, data: { enabled: true, ...await auth.gitlabLinkStatus(activeSession.userId, config.issuer) } });
    return true;
  }
  if (request.method === "POST" && requestPath === "/auth/profile/gitlab/unlink") {
    if (!activeSession) { send(401, fail(new AppError("UNAUTHORIZED", "A session is required."))); return true; }
    const config = gitlabConfig();
    if (request.headers.origin !== new URL(config.callback).origin) {
      send(403, fail(new AppError("INSUFFICIENT_SCOPE", "A same-origin request is required."))); return true;
    }
    await auth.unlinkGitlabIdentity(activeSession.userId, config.issuer);
    send(200, { ok: true, data: { linked: false } }); return true;
  }
  if (request.method === "GET" && requestPath === "/auth/oauth/gitlab/start") {
    const intent = requestUrl.searchParams.get("intent") === "link" ? "link" : "login";
    if (intent === "link" && !activeSession) { send(401, fail(new AppError("UNAUTHORIZED", "Sign in to Marrow before linking GitLab."))); return true; }
    if (intent === "login" && activeSession) { redirect("/projects"); return true; }
    try {
      const config = gitlabConfig();
      const { verifier, challenge } = generatePkce();
      const raw = await auth.mintOAuthState(intent, intent === "link" ? activeSession!.userId : null, null, verifier, "gitlab", config.issuer);
      const binding = startOAuthBinding(raw, isForwardedHttps(request));
      if (!binding.setCookie) throw new Error("Browser binding unavailable");
      const location = await gitlabOidc.authorizeUrl(binding.state, challenge, gitlabNonce(verifier));
      response.writeHead(302, { location, "set-cookie": binding.setCookie, "cache-control": "no-store", "referrer-policy": "no-referrer" });
      response.end();
    } catch { send(503, fail(new AppError("VALIDATION_ERROR", "GitLab sign-in is unavailable. Please try again later."))); }
    return true;
  }
  if (request.method === "GET" && requestPath === "/auth/oauth/gitlab/callback") {
    let link = false;
    try {
      const config = gitlabConfig();
      const state = requestUrl.searchParams.get("state") ?? "";
      const binding = verifyOAuthBinding(state, parseCookies(request));
      if (!state || !binding.ok || binding.legacy) throw new Error("Invalid browser binding");
      const stored = await auth.consumeOAuthState(binding.raw, "gitlab");
      link = stored.intent === "link";
      response.setHeader("set-cookie", `${bindingCookieName(binding.raw)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isForwardedHttps(request) ? "; Secure" : ""}`);
      const code = requestUrl.searchParams.get("code");
      if (!code || requestUrl.searchParams.has("error") || !stored.codeVerifier || stored.issuer !== config.issuer ||
          (requestUrl.searchParams.has("iss") && requestUrl.searchParams.get("iss") !== config.issuer)) throw new Error("Invalid callback");
      if (link && (!activeSession || activeSession.userId !== stored.userId)) throw new Error("Link session changed");
      const identity = await gitlabOidc.resolveUser(code, stored.codeVerifier, stored.issuer);
      if (link) {
        await auth.linkGitlabIdentity(activeSession!.userId, identity);
        redirect("/profile?gitlabLinked=1"); return true;
      }
      const result = await auth.loginViaGitlab(identity, { userAgent: request.headers["user-agent"], ip: request.socket.remoteAddress }, activeSession?.userId);
      if (result.status === "not_linked") {
        redirect(`/login?error=${encodeURIComponent("This GitLab identity is not linked. Sign in with Telegram or GitHub, then connect GitLab in your profile.")}`);
        return true;
      }
      const clearBinding = response.getHeader("set-cookie") as string;
      response.setHeader("set-cookie", [clearBinding, sessionCookieHeader(result.token, isForwardedHttps(request))]);
      redirect("/projects");
    } catch {
      const message = "GitLab sign-in could not be verified. Please start again from Marrow.";
      redirect(link ? `/profile?gitlabError=${encodeURIComponent(message)}` : `/login?error=${encodeURIComponent(message)}`);
    }
    return true;
  }
  return false;
}
