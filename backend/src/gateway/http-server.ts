import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { WebSocketServer } from "ws";
import { useServer as useGraphqlWsServer } from "graphql-ws/use/ws";
import { AppError } from "../shared/errors.js";
import { fail } from "../shared/mcp/tool-response.js";
import { staticTokenClientId, type GatewayRequestContext, type PgToolService } from "./pg-tool-service.js";
import type { AppLogger } from "../shared/logging/logger.js";
import { createGatewayMcpServer } from "./mcp-server.js";
import type { OAuthFacade } from "./oauth.js";
import {
  clearSessionCookieHeader,
  getSessionToken,
  isForwardedHttps,
  sessionCookieHeader,
  type AuthFacade,
  type SessionIdentity
} from "./auth.js";
import { gatewayToolRequiredScopes } from "./tool-definitions.js";
import {
  ADMIN_GRAPHQL_MUTATION_NAMES,
  createGatewayGraphqlServer,
  gatewaySchema,
  handleGatewayGraphqlRequest,
  type GatewayGraphqlServer,
  type GatewaySubscriptionContext
} from "./graphql.js";

// In-memory login rate limiter, keyed independently by email and by IP —
// either one tripping blocks the attempt. Deliberately not Redis-backed:
// this gateway runs as a single instance, so there is no state to share
// across replicas, and an in-memory counter is simpler to operate. Resets
// on process restart, which is an acceptable tradeoff at this scale.
const LOGIN_ATTEMPT_LIMIT = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map<string, { count: number; windowStart: number }>();

function checkAndConsumeLoginAttempt(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (entry.count >= LOGIN_ATTEMPT_LIMIT) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.windowStart + LOGIN_WINDOW_MS - now) / 1000) };
  }
  entry.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function clearLoginAttempts(key: string): void {
  loginAttempts.delete(key);
}

export interface GatewayServerOptions {
  host: string;
  port: number;
  logger?: AppLogger;
  token?: string;
  oauth?: OAuthFacade;
  auth?: AuthFacade;
}

export interface StartedGatewayServer {
  server: Server;
  url: string;
  stop(): Promise<void>;
}

interface ToolCallBody {
  tool?: unknown;
  input?: unknown;
}

type LogFields = Record<string, unknown>;

// Scope model (D-MEMORY-007 / T-MEMORY-029). Three tiers, each a superset of
// the previous: read < write < admin. admin covers hard-delete and other
// destructive operations (*.delete, gateway.client_forget/prune) -- see the
// scope-resolution table in docs/AUTH.md for exactly which auth source maps
// to which tier.
const READ_SCOPE = "memory:read";
const WRITE_SCOPE = "memory:write";
const ADMIN_SCOPE = "memory:admin";
type ScopeTier = "read" | "write" | "admin";

// T-MEMORY-041 / D-MEMORY-019: step-up admin elevation. An OAuth-sourced
// request that needs memory:admin is normally denied outright (decision 2
// above never changes) -- this header lets it carry a short-lived,
// single-use elevation grant (minted by POST /auth/elevate) that, if it
// validates, authorizes exactly this one admin-tier call. The base OAuth
// bearer's own scope is still checked independently; the grant never
// substitutes for a missing/expired/invalid bearer, only for the missing
// memory:admin claim that OAuth tokens are never issued (D-MEMORY-017).
const ELEVATION_HEADER = "x-project-memory-elevation";

// The OAuth authorize params the frontend's POST /oauth/authorize round-trips
// to oauth.ts's authorizeWithSession -- same set validateAuthorizeParams
// (oauth.ts) checks, plus the two optional ones (scope, resource).
const OAUTH_AUTHORIZE_PARAM_NAMES = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "resource"
] as const;

function scopesForTier(tier: ScopeTier): string[] {
  if (tier === "admin") {
    return [READ_SCOPE, WRITE_SCOPE, ADMIN_SCOPE];
  }
  if (tier === "write") {
    return [READ_SCOPE, WRITE_SCOPE];
  }
  return [READ_SCOPE];
}

function requiredTierFor(requiredScopes: string[]): ScopeTier {
  if (requiredScopes.includes(ADMIN_SCOPE)) {
    return "admin";
  }
  if (requiredScopes.includes(WRITE_SCOPE)) {
    return "write";
  }
  return "read";
}

type AuthorizationState =
  | { ok: true; source: "static" | "oauth" | "session" | "personal_token" | "none" }
  | {
      ok: false;
      // "unauthenticated": no valid credential at all (missing/invalid
      // token, no session, expired OAuth token, etc) -- 401.
      // "insufficient_scope": the credential is valid but its scope tier is
      // below what the operation requires -- 403 with a message naming both
      // tiers, never the generic "missing/invalid gateway token" text (see
      // acceptance criteria: "понятную ошибку про недостаточный скоуп, не
      // тихий отказ").
      kind: "unauthenticated" | "insufficient_scope";
      challenge?: string;
      reason?: string;
      requiredTier?: ScopeTier;
      grantedTier?: ScopeTier;
    };

// T-MEMORY-042: extra WS connection state stashed by onConnect and read back
// by context -- graphql-ws's own Extra (socket/request) plus the session
// identity resolved from the upgrade request's cookie. Present on every
// connection that reaches context(), since onConnect rejects the handshake
// before that point for anything without a valid session.
type GatewayWsExtra = Record<PropertyKey, unknown> & {
  sessionIdentity?: SessionIdentity;
};

export async function startGatewayServer(
  service: PgToolService,
  options: GatewayServerOptions
): Promise<StartedGatewayServer> {
  const graphql = await createGatewayGraphqlServer();
  const server = createServer((request, response) => {
    void handleRequest(service, options, graphql, request, response);
  });

  // T-MEMORY-042: live-update WS transport for PMemUI's single
  // `gatewayEvents` subscription (graphql.ts). noServer:true because this
  // gateway hand-rolls its own createServer((req,res)=>...) callback above
  // instead of using a framework -- the WS server never listens on its own
  // port, it only takes over sockets this process's own "upgrade" handler
  // hands it below. Session-cookie auth only (never the static MCP_TOKEN or
  // OAuth) -- see docs/AUTH.md.
  const wsServer = new WebSocketServer({ noServer: true });
  const graphqlWs = useGraphqlWsServer<Record<string, unknown>, GatewayWsExtra>(
    {
      schema: gatewaySchema,
      onConnect: async (ctx) => {
        if (!options.auth) {
          // No AuthFacade configured at all (e.g. a smoke/test harness that
          // never passes `auth`) -- subscriptions have nothing to
          // authenticate against, so refuse every connection rather than
          // silently granting an unscoped feed.
          return false;
        }
        const request = ctx.extra.request;
        const sessionIdentity = await options.auth.identifyFromRequest(request);
        if (!sessionIdentity) {
          // Reject at the upgrade/handshake level: the client's
          // GraphQL-WS connection promise rejects and the socket closes
          // (4403) without ever reaching ConnectionAck.
          return false;
        }
        ctx.extra.sessionIdentity = sessionIdentity;
        return true;
      },
      context: async (ctx): Promise<GatewaySubscriptionContext> => {
        const sessionIdentity = ctx.extra.sessionIdentity;
        if (!sessionIdentity) {
          // Unreachable in practice -- onConnect above always rejects the
          // handshake before a subscribe can ever reach this point without
          // a resolved session. Guarded anyway rather than asserted with a
          // cast, so a future onConnect change fails loudly instead of
          // leaking an all-visible feed.
          throw new AppError("UNAUTHORIZED", "Gateway subscription connection is missing a session identity.");
        }
        return {
          sessionIdentity,
          isProjectVisible: (projectId) =>
            service.isProjectVisibleToSession(projectId, {
              role: sessionIdentity.role,
              userId: sessionIdentity.userId
            })
        };
      }
    },
    wsServer
  );

  server.on("upgrade", (request, socket, head) => {
    if (!isGraphqlRequestPath(parseRequestUrl(request).pathname)) {
      socket.destroy();
      return;
    }
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      wsServer.emit("connection", ws, request);
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, options.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await graphqlWs.dispose();
    await graphql.stop();
    throw error;
  }

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    server,
    url: `http://${options.host}:${port}`,
    async stop() {
      await graphqlWs.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await graphql.stop();
    }
  };
}

async function handleRequest(
  service: PgToolService,
  options: GatewayServerOptions,
  graphql: GatewayGraphqlServer,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const startedAt = Date.now();
  const requestId = request.headers["x-request-id"]?.toString() ?? randomUUID();
  const requestUrl = parseRequestUrl(request);
  const requestPath = requestUrl.pathname;
  const sessionAuth = options.auth ? await options.auth.identifyFromRequest(request) : null;
  // T-MEMORY-047: personal API tokens are a third bearer-auth source,
  // resolved the same way a session cookie is -- via a DB lookup against
  // this request, before isAuthorized() runs. A request carrying neither
  // (or an Authorization header that matches the static token / an OAuth
  // JWT instead) simply resolves this to null, same as sessionAuth above
  // for a request with no session cookie.
  const personalTokenAuth = options.auth ? await options.auth.identifyPersonalToken(request) : null;
  // T-MEMORY-0xx SSO: an OAuth bearer's owning Marrow user, resolved fresh
  // from `users` via its JWT `sub` -- same "resolve once up front, reuse
  // for both context and scope authorization" shape as sessionAuth/
  // personalTokenAuth above. null for a request with no (or invalid/stale)
  // OAuth bearer, same graceful-null convention as those two.
  const oauthOwner = await resolveOAuthOwner(options, request);
  const context = requestContext(request, requestId, sessionAuth, personalTokenAuth, oauthOwner, options);

  const send = (status: number, body: unknown, extra?: LogFields) => {
    sendJson(response, status, body, requestId);
    logRequest(options, request, status, Date.now() - startedAt, requestId, context, extra);
  };

  try {
    if (
      options.oauth &&
      request.method === "GET" &&
      (requestPath === "/.well-known/oauth-protected-resource" ||
        requestPath.startsWith("/.well-known/oauth-protected-resource/"))
    ) {
      send(200, options.oauth.metadata.protectedResource(protectedResourceFromRequestPath(options.oauth, requestPath)));
      return;
    }

    if (
      options.oauth &&
      request.method === "GET" &&
      (requestPath === "/.well-known/oauth-authorization-server" ||
        requestPath.startsWith("/.well-known/oauth-authorization-server/") ||
        requestPath === "/.well-known/openid-configuration" ||
        requestPath.startsWith("/.well-known/openid-configuration/"))
    ) {
      send(200, options.oauth.metadata.authorizationServer());
      return;
    }

    if (options.oauth && request.method === "GET" && requestPath === "/.well-known/jwks.json") {
      send(200, options.oauth.metadata.jwks());
      return;
    }

    // SSO authorize flow (replaces the old shared-magic-token gate): GET is
    // the top-level browser navigation an OAuth client (Claude Code,
    // ChatGPT) redirects the user to -- it never renders UI itself anymore,
    // it 302s straight to Marrow's own frontend (same origin, root path) so
    // the frontend's login/consent screen can run there instead.
    if (options.oauth && request.method === "GET" && requestPath === "/oauth/authorize") {
      const result = await options.oauth.authorizeRedirectUrl(requestUrl);
      if (!result.ok) {
        send(400, fail(new AppError("VALIDATION_ERROR", result.error)));
        return;
      }
      response.writeHead(302, {
        location: result.location,
        "x-request-id": requestId
      });
      response.end();
      logRequest(options, request, 302, Date.now() - startedAt, requestId, context);
      return;
    }

    // POST is called by the frontend itself (fetch with credentials:
    // 'include', not a browser form submit) once it has confirmed a
    // pmem_session -- either an existing cookie, or one just established via
    // the frontend's own login/TOTP screens. No magic token anywhere in this
    // path; a valid session is the only thing that can mint a code, and the
    // code is stamped with that session's real userId.
    if (options.oauth && request.method === "POST" && requestPath === "/oauth/authorize") {
      const body = (await readJson(request)) as Record<string, unknown>;
      const logFields = {
        requestBody: sanitizeLogBody(body),
        oauthClientId: typeof body.client_id === "string" ? body.client_id : undefined
      };
      if (!sessionAuth) {
        send(
          401,
          fail(new AppError("UNAUTHORIZED", "A Marrow session is required to authorize this OAuth client.")),
          logFields
        );
        return;
      }
      const params = new URLSearchParams();
      for (const key of OAUTH_AUTHORIZE_PARAM_NAMES) {
        const value = body[key];
        if (typeof value === "string") {
          params.set(key, value);
        }
      }
      const result = await options.oauth.authorizeWithSession(params, sessionAuth.userId);
      if (!result.ok) {
        send(400, fail(new AppError("VALIDATION_ERROR", result.error)), logFields);
        return;
      }
      send(200, { ok: true, data: { redirectUri: result.redirectUri } }, logFields);
      return;
    }

    if (options.oauth && request.method === "POST" && requestPath === "/oauth/token") {
      const form = await readForm(request);
      const result = await options.oauth.token(form, request);
      send(result.status, result.body, {
        requestBody: formLogBody(form),
        oauthGrantType: form.get("grant_type") ?? undefined,
        oauthClientId: form.get("client_id") ?? undefined
      });
      return;
    }

    if (request.method === "OPTIONS" && isGraphqlRequestPath(requestPath)) {
      const result = await handleGatewayGraphqlRequest({
        graphql,
        request,
        response,
        requestContext: context,
        requestId,
        service,
        logger: options.logger
      });
      logRequest(options, request, result.status, Date.now() - startedAt, requestId, context);
      return;
    }

    if (options.auth && requestPath.startsWith("/auth/")) {
      try {
        const handled = await handleAuthRoute(
          options.auth,
          service,
          request,
          response,
          requestUrl,
          requestPath,
          sessionAuth,
          send
        );
        if (handled) {
          return;
        }
      } catch (error) {
        if (error instanceof AppError) {
          const status =
            error.code === "VALIDATION_ERROR"
              ? 400
              : error.code === "UNAUTHORIZED"
                ? 401
                : error.code === "INSUFFICIENT_SCOPE"
                  ? 403
                  : error.code === "NOT_FOUND"
                    ? 404
                    : 500;
          send(status, fail(error));
          return;
        }
        throw error;
      }
    }

    // Project sharing: unauthenticated invite-landing lookup, same
    // "no scope/session gate at all" shape as GET /auth/claim above -- a
    // fully anonymous visitor who followed a shared /invite/:code link
    // needs to see "You're invited to join {projectTitle}" before this
    // gateway even knows who they are. Deliberately a dedicated REST route,
    // not a GraphQL query: the GraphQL pipeline always runs
    // isAuthorizedForScopes() first (memory:read at minimum), which would
    // 401 a caller with no credential at all whenever a static token is
    // configured -- this route bypasses that entirely, matching /auth/*'s
    // own pattern above. Returns only {projectTitle, projectSlug}, nothing
    // else -- see resolveProjectInviteContext's own comment in
    // projects-core.mixin.ts for why that's safe to expose with no auth.
    const projectInviteContextMatch = requestPath.match(/^\/project-invites\/([^/]+)$/);
    if (request.method === "GET" && projectInviteContextMatch) {
      try {
        const result = await service.projectInviteContext(decodeURIComponent(projectInviteContextMatch[1]!));
        send(200, { ok: true, data: result });
      } catch (error) {
        if (error instanceof AppError) {
          send(error.code === "NOT_FOUND" ? 404 : 500, fail(error));
          return;
        }
        throw error;
      }
      return;
    }

    const auth = isAuthorized(options, request, sessionAuth, personalTokenAuth);
    if (!auth.ok) {
      sendUnauthorized(response, requestId, auth);
      logRequest(options, request, 401, Date.now() - startedAt, requestId, context, {
        authReason: auth.reason
      });
      return;
    }

    if (isGraphqlRequestPath(requestPath)) {
      await handleGraphqlRequest(
        service,
        options,
        graphql,
        request,
        response,
        requestId,
        context,
        startedAt,
        auth,
        sessionAuth,
        personalTokenAuth,
        oauthOwner
      );
      return;
    }

    if (requestPath === "/mcp") {
      await handleMcpRequest(
        service,
        options,
        request,
        response,
        requestId,
        context,
        startedAt,
        auth,
        sessionAuth,
        personalTokenAuth,
        oauthOwner
      );
      return;
    }

    if (request.method === "GET" && requestPath === "/health") {
      send(200, { ok: true, service: "project-memory-gateway" });
      return;
    }

    if (request.method === "GET" && requestPath === "/ready") {
      const readiness = await service.readiness();
      send(readiness.ok ? 200 : 503, readiness);
      return;
    }

    if (request.method === "GET" && requestPath === "/tools") {
      send(200, { ok: true, tools: service.listTools() });
      return;
    }

    const artifactDownloadMatch = requestPath.match(/^\/artifacts\/([^/]+)\/download$/);
    if (request.method === "GET" && artifactDownloadMatch) {
      await sendArtifactDownload(service, options, request, response, requestId, startedAt, context, artifactDownloadMatch[1]);
      return;
    }

    if (request.method === "POST" && requestPath === "/call") {
      const body = (await readJson(request)) as ToolCallBody;
      if (typeof body.tool !== "string") {
        send(400, fail(new AppError("VALIDATION_ERROR", "Request body must include a string tool.")), {
          requestBody: sanitizeLogBody(body)
        });
        return;
      }
      const scopeAuth = await isAuthorizedForScopes(
        options,
        request,
        auth,
        sessionAuth,
        personalTokenAuth,
        oauthOwner,
        gatewayToolRequiredScopes(body.tool)
      );
      if (!scopeAuth.ok) {
        sendUnauthorized(response, requestId, scopeAuth);
        logRequest(options, request, authFailureStatus(scopeAuth), Date.now() - startedAt, requestId, context, {
          tool: body.tool,
          requestBody: sanitizeLogBody(body),
          requiredScopes: gatewayToolRequiredScopes(body.tool),
          authReason: scopeAuth.reason,
          scopeKind: scopeAuth.kind,
          requiredTier: scopeAuth.requiredTier,
          grantedTier: scopeAuth.grantedTier
        });
        return;
      }
      const toolStartedAt = Date.now();
      const result = await service.call(body.tool, body.input ?? {}, context);
      options.logger?.info(
        {
          requestId,
          clientId: context.clientId,
          tool: body.tool,
          toolInput: sanitizeLogBody(body.input ?? {}),
          durationMs: Date.now() - toolStartedAt,
          ok: result.ok
        },
        "gateway tool call completed"
      );
      send(200, result, {
        tool: body.tool,
        requestBody: sanitizeLogBody(body)
      });
      return;
    }

    send(404, fail(new AppError("NOT_FOUND", `Route ${request.method ?? "GET"} ${request.url ?? "/"} not found.`)));
  } catch (error) {
    options.logger?.error(
      {
        requestId,
        clientId: context.clientId,
        error
      },
      "gateway request failed"
    );
    send(500, fail(error));
  }
}

async function handleGraphqlRequest(
  service: PgToolService,
  options: GatewayServerOptions,
  graphql: GatewayGraphqlServer,
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
  context: GatewayRequestContext,
  startedAt: number,
  auth: AuthorizationState,
  sessionAuth: SessionIdentity | null,
  personalTokenAuth: SessionIdentity | null,
  oauthOwner: OAuthOwner | null
): Promise<void> {
  try {
    const body = request.method === "POST" ? await readJson(request) : undefined;
    const requiredScopes = graphqlRequiredScopes(request, body);
    const scopeAuth = await isAuthorizedForScopes(
      options,
      request,
      auth,
      sessionAuth,
      personalTokenAuth,
      oauthOwner,
      requiredScopes
    );
    if (!scopeAuth.ok) {
      sendUnauthorized(response, requestId, scopeAuth);
      logRequest(options, request, authFailureStatus(scopeAuth), Date.now() - startedAt, requestId, context, {
        requiredScopes,
        graphqlOperationType: requiredScopes.includes(WRITE_SCOPE) ? "mutation" : "query",
        authReason: scopeAuth.reason,
        scopeKind: scopeAuth.kind,
        requiredTier: scopeAuth.requiredTier,
        grantedTier: scopeAuth.grantedTier
      });
      return;
    }
    const result = await handleGatewayGraphqlRequest({
      graphql,
      request,
      response,
      requestContext: context,
      requestId,
      service,
      logger: options.logger,
      body
    });
    const graphqlLogFields: LogFields = {
      graphqlOperationName: result.operationName,
      requiredScopes
    };
    if (result.errors?.length) {
      graphqlLogFields.graphqlErrorCount = result.errors.length;
      graphqlLogFields.graphqlErrors = result.errors;
      graphqlLogFields.requestBody = sanitizeLogBody(body);
    }
    logRequest(options, request, result.status, Date.now() - startedAt, requestId, context, {
      ...graphqlLogFields
    });
  } catch (error) {
    options.logger?.error({ requestId, clientId: context.clientId, error }, "gateway graphql request failed");
    if (!response.headersSent) {
      sendJson(response, 500, fail(error), requestId);
    }
    logRequest(options, request, response.statusCode || 500, Date.now() - startedAt, requestId, context);
  }
}

async function sendArtifactDownload(
  service: PgToolService,
  options: GatewayServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
  startedAt: number,
  context: GatewayRequestContext,
  encodedId: string
): Promise<void> {
  const id = decodeURIComponent(encodedId);
  const download = await service.artifactDownload(id);
  const fileStat = await stat(download.absolutePath);
  const filename = path.posix.basename(download.artifact.path).replace(/["\\]/g, "_");
  response.writeHead(200, {
    "content-type": download.artifact.contentType,
    "content-length": fileStat.size,
    "content-disposition": `attachment; filename="${filename}"`,
    "x-request-id": requestId,
    "x-artifact-id": download.artifact.id,
    "x-artifact-sha256": download.artifact.sha256
  });
  createReadStream(download.absolutePath).pipe(response);
  response.on("finish", () => {
    logRequest(options, request, response.statusCode, Date.now() - startedAt, requestId, context);
  });
}

async function handleMcpRequest(
  service: PgToolService,
  options: GatewayServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
  context: GatewayRequestContext,
  startedAt: number,
  auth: AuthorizationState,
  sessionAuth: SessionIdentity | null,
  personalTokenAuth: SessionIdentity | null,
  oauthOwner: OAuthOwner | null
): Promise<void> {
  if (request.method !== "POST") {
    sendJson(
      response,
      405,
      {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed."
        },
        id: null
      },
      requestId
    );
    logRequest(options, request, 405, Date.now() - startedAt, requestId, context);
    return;
  }

  const server = createGatewayMcpServer(service, context);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });
  let logFields: LogFields | undefined;

  try {
    await server.connect(transport);
    const body = await readJson(request);
    logFields = mcpLogFields(body);
    const requiredScopes = mcpRequiredScopes(body);
    const scopeAuth = await isAuthorizedForScopes(
      options,
      request,
      auth,
      sessionAuth,
      personalTokenAuth,
      oauthOwner,
      requiredScopes
    );
    if (!scopeAuth.ok) {
      sendMcpUnauthorized(response, requestId, scopeAuth);
      logRequest(options, request, authFailureStatus(scopeAuth), Date.now() - startedAt, requestId, context, {
        ...logFields,
        requiredScopes,
        authReason: scopeAuth.reason,
        scopeKind: scopeAuth.kind,
        requiredTier: scopeAuth.requiredTier,
        grantedTier: scopeAuth.grantedTier
      });
      return;
    }
    await transport.handleRequest(request, response, body);
    logRequest(options, request, response.statusCode, Date.now() - startedAt, requestId, context, logFields);
  } catch (error) {
    options.logger?.error({ requestId, clientId: context.clientId, ...logFields, error }, "gateway mcp request failed");
    if (!response.headersSent) {
      sendJson(
        response,
        500,
        {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error"
          },
          id: null
        },
        requestId
      );
      logRequest(options, request, 500, Date.now() - startedAt, requestId, context, logFields);
    }
  } finally {
    await transport.close();
    await server.close();
  }
}

async function handleAuthRoute(
  auth: AuthFacade,
  service: PgToolService,
  request: IncomingMessage,
  response: ServerResponse,
  requestUrl: URL,
  requestPath: string,
  sessionAuth: SessionIdentity | null,
  send: (status: number, body: unknown, extra?: LogFields) => void
): Promise<boolean> {
  if (request.method === "POST" && requestPath === "/auth/invite") {
    if (!sessionAuth || sessionAuth.role !== "admin") {
      send(401, fail(new AppError("UNAUTHORIZED", "An admin session is required to create invites.")));
      return true;
    }
    const body = (await readJson(request)) as { email?: unknown };
    if (typeof body.email !== "string" || !body.email.trim()) {
      send(400, fail(new AppError("VALIDATION_ERROR", "email is required.")));
      return true;
    }
    const result = await auth.invite(body.email, sessionAuth.userId);
    send(200, { ok: true, data: { email: result.email, claimPath: `/auth/claim?token=${result.token}` } });
    return true;
  }

  if (request.method === "GET" && requestPath === "/auth/claim") {
    const token = queryString(requestUrl, "token");
    if (!token) {
      send(400, fail(new AppError("VALIDATION_ERROR", "token is required.")));
      return true;
    }
    const result = await auth.claimContext(token);
    send(200, { ok: true, data: result });
    return true;
  }

  if (request.method === "POST" && requestPath === "/auth/claim") {
    const body = (await readJson(request)) as { token?: unknown; password?: unknown };
    if (typeof body.token !== "string" || typeof body.password !== "string") {
      send(400, fail(new AppError("VALIDATION_ERROR", "token and password are required.")));
      return true;
    }
    const result = await auth.claim(body.token, body.password);
    send(200, {
      ok: true,
      data: {
        email: result.email,
        emailVerified: result.emailVerified,
        verifyEmailPath: result.verifyToken ? `/auth/verify-email?token=${result.verifyToken}` : undefined
      }
    });
    return true;
  }

  if (request.method === "POST" && requestPath === "/auth/verify-email") {
    const token = queryString(requestUrl, "token");
    if (!token) {
      send(400, fail(new AppError("VALIDATION_ERROR", "token is required.")));
      return true;
    }
    await auth.verifyEmail(token);
    send(200, { ok: true, data: { verified: true } });
    return true;
  }

  if (request.method === "POST" && requestPath === "/auth/login") {
    const body = (await readJson(request)) as { email?: unknown; password?: unknown };
    if (typeof body.email !== "string" || typeof body.password !== "string") {
      send(400, fail(new AppError("VALIDATION_ERROR", "email and password are required.")));
      return true;
    }

    const ip = clientIp(request);
    const emailKey = `email:${body.email.trim().toLowerCase()}`;
    const ipKey = `ip:${ip}`;
    const emailLimit = checkAndConsumeLoginAttempt(emailKey);
    const ipLimit = checkAndConsumeLoginAttempt(ipKey);
    if (!emailLimit.allowed || !ipLimit.allowed) {
      const retryAfterSeconds = Math.max(emailLimit.retryAfterSeconds, ipLimit.retryAfterSeconds);
      response.setHeader("retry-after", String(retryAfterSeconds));
      send(
        429,
        fail(new AppError("VALIDATION_ERROR", "Too many login attempts. Try again later.")),
        { requestBody: { email: body.email }, authReason: "rate_limited" }
      );
      return true;
    }

    const result = await auth.login(body.email, body.password, { userAgent: headerString(request, "user-agent"), ip });
    clearLoginAttempts(emailKey);
    clearLoginAttempts(ipKey);
    if (result.status === "pending_totp") {
      send(200, { ok: true, data: { status: "pending_totp", userId: result.userId } }, {
        requestBody: { email: body.email }
      });
      return true;
    }
    response.setHeader("set-cookie", sessionCookieHeader(result.token, isForwardedHttps(request)));
    send(200, { ok: true, data: { status: "session", user: result.user } }, { requestBody: { email: body.email } });
    return true;
  }

  if (request.method === "POST" && requestPath === "/auth/logout") {
    const rawToken = getSessionToken(request);
    if (rawToken) {
      await auth.logout(rawToken);
    }
    response.setHeader("set-cookie", clearSessionCookieHeader(isForwardedHttps(request)));
    send(200, { ok: true, data: { loggedOut: true } });
    return true;
  }

  if (request.method === "GET" && requestPath === "/auth/me") {
    if (!sessionAuth) {
      send(401, fail(new AppError("UNAUTHORIZED", "No active session.")));
      return true;
    }
    send(200, {
      ok: true,
      data: {
        id: sessionAuth.userId,
        email: sessionAuth.email,
        role: sessionAuth.role,
        status: sessionAuth.status,
        totpEnabled: sessionAuth.totpEnabled
      }
    });
    return true;
  }

  if (request.method === "GET" && requestPath === "/auth/bootstrap") {
    const result = await auth.bootstrapStatus();
    send(200, { ok: true, data: result });
    return true;
  }

  if (request.method === "POST" && requestPath === "/auth/bootstrap") {
    const body = (await readJson(request)) as { email?: unknown; password?: unknown };
    if (typeof body.email !== "string" || typeof body.password !== "string") {
      send(400, fail(new AppError("VALIDATION_ERROR", "email and password are required.")));
      return true;
    }
    const result = await auth.bootstrapFirstAdmin(body.email, body.password, {
      userAgent: headerString(request, "user-agent"),
      ip: clientIp(request)
    });
    if (result.status === "pending_totp") {
      // Unreachable: a freshly bootstrapped admin never has totp_enabled set.
      send(500, fail(new AppError("VALIDATION_ERROR", "Unexpected pending_totp on bootstrap.")));
      return true;
    }
    response.setHeader("set-cookie", sessionCookieHeader(result.token, isForwardedHttps(request)));
    send(200, { ok: true, data: { status: "session", user: result.user } }, { requestBody: { email: body.email } });
    return true;
  }

  // --- TOTP 2FA: shared bind/unbind profile section (T-MEMORY-028) ---

  if (request.method === "POST" && requestPath === "/auth/2fa/enroll") {
    if (!sessionAuth) {
      send(401, fail(new AppError("UNAUTHORIZED", "No active session.")));
      return true;
    }
    const result = await auth.enrollTotp(sessionAuth.userId);
    send(200, { ok: true, data: result });
    return true;
  }

  if (request.method === "POST" && requestPath === "/auth/2fa/confirm") {
    if (!sessionAuth) {
      send(401, fail(new AppError("UNAUTHORIZED", "No active session.")));
      return true;
    }
    const body = (await readJson(request)) as { code?: unknown };
    if (typeof body.code !== "string" || !body.code.trim()) {
      send(400, fail(new AppError("VALIDATION_ERROR", "code is required.")));
      return true;
    }
    const result = await auth.confirmTotp(sessionAuth.userId, body.code);
    send(200, { ok: true, data: result });
    return true;
  }

  if (request.method === "POST" && requestPath === "/auth/2fa/disable") {
    if (!sessionAuth) {
      send(401, fail(new AppError("UNAUTHORIZED", "No active session.")));
      return true;
    }
    const body = (await readJson(request)) as { currentPassword?: unknown };
    if (typeof body.currentPassword !== "string") {
      send(400, fail(new AppError("VALIDATION_ERROR", "currentPassword is required.")));
      return true;
    }
    await auth.disableTotp(sessionAuth.userId, body.currentPassword);
    send(200, { ok: true, data: { disabled: true } });
    return true;
  }

  if (request.method === "POST" && requestPath === "/auth/2fa/recovery-codes/regenerate") {
    if (!sessionAuth) {
      send(401, fail(new AppError("UNAUTHORIZED", "No active session.")));
      return true;
    }
    const body = (await readJson(request)) as { currentPassword?: unknown };
    if (typeof body.currentPassword !== "string") {
      send(400, fail(new AppError("VALIDATION_ERROR", "currentPassword is required.")));
      return true;
    }
    const result = await auth.regenerateRecoveryCodes(sessionAuth.userId, body.currentPassword);
    send(200, { ok: true, data: result });
    return true;
  }

  if (request.method === "POST" && requestPath === "/auth/profile/password") {
    if (!sessionAuth) {
      send(401, fail(new AppError("UNAUTHORIZED", "No active session.")));
      return true;
    }
    const body = (await readJson(request)) as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string") {
      send(400, fail(new AppError("VALIDATION_ERROR", "currentPassword and newPassword are required.")));
      return true;
    }
    await auth.changePassword(sessionAuth.userId, body.currentPassword, body.newPassword);
    send(200, { ok: true, data: { changed: true } });
    return true;
  }

  // --- Personal API tokens (T-MEMORY-047) ---
  // Session-only, same "raw secret only enters/leaves through the trusted
  // browser profile UI" convention as password/2FA/git-credential management
  // above -- no MCP tool or GraphQL mutation manages this. GET never creates
  // a token (side-effect-free); the frontend's Connect section calls
  // regenerate explicitly (auto-triggered on first visit when none exists
  // yet, or on an explicit "Regenerate" click) -- see front/src/pages/profile.

  if (request.method === "GET" && requestPath === "/auth/profile/personal-token") {
    if (!sessionAuth) {
      send(401, fail(new AppError("UNAUTHORIZED", "No active session.")));
      return true;
    }
    const result = await auth.personalTokenStatus(sessionAuth.userId);
    send(200, { ok: true, data: result });
    return true;
  }

  if (request.method === "POST" && requestPath === "/auth/profile/personal-token/regenerate") {
    if (!sessionAuth) {
      send(401, fail(new AppError("UNAUTHORIZED", "No active session.")));
      return true;
    }
    const result = await auth.regeneratePersonalToken(sessionAuth.userId);
    send(200, {
      ok: true,
      data: { token: result.token, tokenHint: result.tokenHint, createdAt: result.createdAt.toISOString() }
    });
    return true;
  }

  // --- Per-user OAuth connector credentials (replaces the old static,
  // shared PROJECT_MEMORY_OAUTH_CLIENT_ID/_SECRET pair) ---
  // Session-only, same convention as the personal-token pair just above --
  // no MCP tool or GraphQL mutation manages this. GET never creates a
  // client (side-effect-free); the frontend's Connect section calls
  // regenerate only on an explicit "Generate"/"Regenerate" click (no
  // lazy-auto-generate on first visit, unlike personal tokens -- client_id/
  // secret are for the web-connector OAuth flow, not needed just to view
  // the profile page) -- see front/src/features/auth/OAuthClientPanel.

  if (request.method === "GET" && requestPath === "/auth/profile/oauth-client") {
    if (!sessionAuth) {
      send(401, fail(new AppError("UNAUTHORIZED", "No active session.")));
      return true;
    }
    const result = await auth.oauthClientStatus(sessionAuth.userId);
    send(200, { ok: true, data: result });
    return true;
  }

  if (request.method === "POST" && requestPath === "/auth/profile/oauth-client/regenerate") {
    if (!sessionAuth) {
      send(401, fail(new AppError("UNAUTHORIZED", "No active session.")));
      return true;
    }
    const result = await auth.regenerateOAuthClient(sessionAuth.userId);
    send(200, {
      ok: true,
      data: { clientId: result.clientId, clientSecret: result.clientSecret, createdAt: result.createdAt.toISOString() }
    });
    return true;
  }

  // --- Notifications unread state (T-MEMORY-051) ---
  // Session-only, same convention as the personal-token pair just above --
  // no MCP tool or GraphQL mutation manages this. GET never mutates
  // (side-effect-free); the frontend's notifications page calls the POST
  // once on mount to mark everything seen -- see front/src/pages/notifications.

  if (request.method === "GET" && requestPath === "/auth/profile/notifications") {
    if (!sessionAuth) {
      send(401, fail(new AppError("UNAUTHORIZED", "No active session.")));
      return true;
    }
    const result = await auth.notificationsSeenAt(sessionAuth.userId);
    send(200, { ok: true, data: result });
    return true;
  }

  if (request.method === "POST" && requestPath === "/auth/profile/notifications-seen") {
    if (!sessionAuth) {
      send(401, fail(new AppError("UNAUTHORIZED", "No active session.")));
      return true;
    }
    const result = await auth.markNotificationsSeen(sessionAuth.userId);
    send(200, { ok: true, data: result });
    return true;
  }

  // --- Second login step for totp_enabled accounts (T-MEMORY-028) ---
  // Rate-limited the same way as /auth/login, but keyed by userId (there's
  // no email in this body) alongside client IP.

  if (request.method === "POST" && requestPath === "/auth/login/2fa") {
    const body = (await readJson(request)) as { userId?: unknown; code?: unknown };
    if (typeof body.userId !== "string" || typeof body.code !== "string") {
      send(400, fail(new AppError("VALIDATION_ERROR", "userId and code are required.")));
      return true;
    }

    const ip = clientIp(request);
    const userKey = `userId:${body.userId}`;
    const ipKey = `ip:${ip}`;
    const userLimit = checkAndConsumeLoginAttempt(userKey);
    const ipLimit = checkAndConsumeLoginAttempt(ipKey);
    if (!userLimit.allowed || !ipLimit.allowed) {
      const retryAfterSeconds = Math.max(userLimit.retryAfterSeconds, ipLimit.retryAfterSeconds);
      response.setHeader("retry-after", String(retryAfterSeconds));
      send(429, fail(new AppError("VALIDATION_ERROR", "Too many login attempts. Try again later.")), {
        requestBody: { userId: body.userId },
        authReason: "rate_limited"
      });
      return true;
    }

    const result = await auth.loginTotp(body.userId, body.code, {
      userAgent: headerString(request, "user-agent"),
      ip
    });
    clearLoginAttempts(userKey);
    clearLoginAttempts(ipKey);
    response.setHeader("set-cookie", sessionCookieHeader(result.token, isForwardedHttps(request)));
    send(200, { ok: true, data: { status: "session", user: result.user } }, { requestBody: { userId: body.userId } });
    return true;
  }

  // --- Step-up admin elevation (T-MEMORY-041, D-MEMORY-019) ---
  // Deliberately public (no session/bearer required to reach this route at
  // all, same as /auth/login) -- the authorization comes entirely from the
  // body proving live possession of a specific admin account's password
  // *and* current TOTP code, not from whatever credential the HTTP request
  // itself carried. Rate-limited the same way as /auth/login (email + IP
  // keys, same in-memory limiter/window), separate key prefix so it
  // doesn't share counters with plain login attempts against the same
  // account.

  if (request.method === "POST" && requestPath === "/auth/elevate") {
    const body = (await readJson(request)) as { email?: unknown; password?: unknown; code?: unknown };
    if (
      typeof body.email !== "string" ||
      typeof body.password !== "string" ||
      typeof body.code !== "string"
    ) {
      send(400, fail(new AppError("VALIDATION_ERROR", "email, password, and code are required.")));
      return true;
    }

    const ip = clientIp(request);
    const emailKey = `elevate-email:${body.email.trim().toLowerCase()}`;
    const ipKey = `elevate-ip:${ip}`;
    const emailLimit = checkAndConsumeLoginAttempt(emailKey);
    const ipLimit = checkAndConsumeLoginAttempt(ipKey);
    if (!emailLimit.allowed || !ipLimit.allowed) {
      const retryAfterSeconds = Math.max(emailLimit.retryAfterSeconds, ipLimit.retryAfterSeconds);
      response.setHeader("retry-after", String(retryAfterSeconds));
      send(429, fail(new AppError("VALIDATION_ERROR", "Too many elevation attempts. Try again later.")), {
        requestBody: { email: body.email },
        authReason: "rate_limited"
      });
      return true;
    }

    const grant = await auth.requestElevation(body.email, body.password, body.code, {
      userAgent: headerString(request, "user-agent"),
      ip
    });
    clearLoginAttempts(emailKey);
    clearLoginAttempts(ipKey);
    send(
      200,
      { ok: true, data: { token: grant.token, expiresAt: grant.expiresAt.toISOString() } },
      { requestBody: { email: body.email } }
    );
    return true;
  }

  // --- Open self-registration + admin approval (T-MEMORY-038, D-MEMORY-016) ---

  if (request.method === "POST" && requestPath === "/auth/register") {
    const body = (await readJson(request)) as { email?: unknown; password?: unknown };
    if (typeof body.email !== "string" || typeof body.password !== "string") {
      send(400, fail(new AppError("VALIDATION_ERROR", "email and password are required.")));
      return true;
    }
    const result = await auth.register(body.email, body.password);
    send(200, { ok: true, data: result }, { requestBody: { email: body.email } });
    return true;
  }

  if (request.method === "POST" && requestPath === "/auth/register/confirm") {
    const body = (await readJson(request)) as { token?: unknown; code?: unknown };
    if (typeof body.token !== "string" || typeof body.code !== "string") {
      send(400, fail(new AppError("VALIDATION_ERROR", "token and code are required.")));
      return true;
    }
    const result = await auth.registerConfirm(body.token, body.code);
    await service.recordSystemEvent("user.registration_pending", `Awaiting approval: ${result.email}`);
    send(200, { ok: true, data: result });
    return true;
  }

  if (request.method === "GET" && requestPath === "/auth/admin/pending-users") {
    if (!sessionAuth || sessionAuth.role !== "admin") {
      send(401, fail(new AppError("UNAUTHORIZED", "An admin session is required to list pending users.")));
      return true;
    }
    const result = await auth.listPendingApprovals();
    send(200, { ok: true, data: result });
    return true;
  }

  const pendingMatch = requestPath.match(/^\/auth\/admin\/pending-users\/([^/]+)\/(approve|reject)$/);
  if (request.method === "POST" && pendingMatch) {
    if (!sessionAuth || sessionAuth.role !== "admin") {
      send(401, fail(new AppError("UNAUTHORIZED", "An admin session is required to approve or reject users.")));
      return true;
    }
    const [, pendingUserId, action] = pendingMatch;
    if (action === "approve") {
      await auth.approveUser(pendingUserId);
      await service.recordSystemEvent("user.approved", "User approved", pendingUserId);
    } else {
      await auth.rejectUser(pendingUserId);
      await service.recordSystemEvent("user.rejected", "User rejected", pendingUserId);
    }
    send(200, { ok: true, data: { id: pendingUserId, status: action === "approve" ? "active" : "disabled" } });
    return true;
  }

  return false;
}

function mcpLogFields(body: unknown): LogFields {
  if (Array.isArray(body)) {
    return {
      mcpBatchSize: body.length,
      mcpRequests: sanitizeLogBody(body.map((item) => mcpMessageSummary(item)))
    };
  }

  const summary = mcpMessageSummary(body);
  return {
    ...summary,
    requestBody: sanitizeLogBody(body)
  };
}

function mcpMessageSummary(value: unknown): LogFields {
  if (!isRecord(value)) {
    return { mcpMessageType: typeof value };
  }

  const method = typeof value.method === "string" ? value.method : undefined;
  const id = typeof value.id === "string" || typeof value.id === "number" ? value.id : undefined;
  const params = isRecord(value.params) ? value.params : {};
  const tool = typeof params.name === "string" ? params.name : undefined;
  const fields: LogFields = {
    mcpMethod: method,
    mcpId: id
  };
  if (tool) {
    fields.mcpTool = tool;
    fields.toolArguments = sanitizeLogBody(params.arguments ?? {});
  }
  return fields;
}

function mcpRequiredScopes(body: unknown): string[] {
  const messages = Array.isArray(body) ? body : [body];
  const scopes = new Set<string>(["memory:read"]);
  for (const message of messages) {
    const toolName = mcpToolName(message);
    if (!toolName) {
      continue;
    }
    for (const scope of gatewayToolRequiredScopes(toolName)) {
      scopes.add(scope);
    }
  }
  return [...scopes];
}

function mcpToolName(value: unknown): string | undefined {
  if (!isRecord(value) || value.method !== "tools/call" || !isRecord(value.params)) {
    return undefined;
  }
  return typeof value.params.name === "string" ? value.params.name : undefined;
}

// The regex-based `/\bmutation\b/i` check can't distinguish a delete
// mutation from a create/update one by text alone, so admin-tier mutations
// (the *.delete equivalents, see ADMIN_GRAPHQL_MUTATION_NAMES in graphql.ts)
// need a second, name-specific check to require memory:admin like their
// REST/MCP tool counterparts do.
const ADMIN_GRAPHQL_MUTATION_PATTERN = new RegExp(`\\b(${ADMIN_GRAPHQL_MUTATION_NAMES.join("|")})\\s*\\(`);

function graphqlRequiredScopes(request: IncomingMessage, body: unknown): string[] {
  const queries = graphqlQueryTexts(request, body);
  if (queries.some((query) => ADMIN_GRAPHQL_MUTATION_PATTERN.test(query))) {
    return [READ_SCOPE, WRITE_SCOPE, ADMIN_SCOPE];
  }
  if (queries.some((query) => /\bmutation\b/i.test(query))) {
    return [READ_SCOPE, WRITE_SCOPE];
  }
  return [READ_SCOPE];
}

function graphqlQueryTexts(request: IncomingMessage, body: unknown): string[] {
  const requestUrl = parseRequestUrl(request);
  return [requestUrl.searchParams.get("query"), ...graphqlBodyQueries(body)].filter((query): query is string =>
    Boolean(query)
  );
}

function graphqlBodyQueries(body: unknown): string[] {
  if (Array.isArray(body)) {
    return body.flatMap((item) => graphqlBodyQueries(item));
  }
  if (!isRecord(body)) {
    return [];
  }
  return typeof body.query === "string" ? [body.query] : [];
}

function requestContext(
  request: IncomingMessage,
  requestId: string,
  sessionAuth: SessionIdentity | null,
  personalTokenAuth: SessionIdentity | null,
  oauthOwner: OAuthOwner | null,
  options: GatewayServerOptions
): GatewayRequestContext {
  const requestUrl = parseRequestUrl(request);
  const explicitClientId = headerString(request, "x-project-memory-client-id") ?? queryString(requestUrl, "client_id");
  // Static MCP_TOKEN requests otherwise fell through to a fresh
  // `anonymous:${requestId}` on every single request -- no stable identity
  // at all, unlike a session (`user:<id>`) or an explicit client-id header.
  // Duplicated (not shared) with isAuthorized()'s own static-token check
  // below: isAuthorized() runs later in the request lifecycle and this
  // context is built before it, including for routes that never reach it.
  const isStaticTokenAuth = Boolean(options.token) && request.headers.authorization === `Bearer ${options.token}`;
  // T-MEMORY-047: a personal-token bearer identifies exactly one user, same
  // as a session cookie -- treated identically here (clientId, scope tier,
  // project-membership filtering all key off this). Session cookie wins if
  // a request somehow carries both (cookie is the primary browser auth
  // mechanism; a bearer header alongside it is incidental).
  const identity = sessionAuth ?? personalTokenAuth;
  const clientId =
    explicitClientId ??
    (identity ? `user:${identity.userId}` : isStaticTokenAuth ? staticTokenClientId : `anonymous:${requestId}`);
  const clientLabel =
    headerString(request, "x-project-memory-client-label") ??
    queryString(requestUrl, "client_label") ??
    (identity ? identity.email : explicitClientId ? clientId : isStaticTokenAuth ? "static-token" : "anonymous");
  return {
    clientId,
    clientLabel,
    metadata: {
      anonymous: explicitClientId ? false : !identity && !isStaticTokenAuth,
      kind: headerString(request, "x-project-memory-client-kind") ?? queryString(requestUrl, "client_kind") ?? "http",
      userAgent: headerString(request, "user-agent")
    },
    // T-MEMORY-052: falls back to the resolved OAuth owner when there's no
    // session/personal-token identity, so project-membership filtering
    // (assertProjectMember, applyProjectMembershipFilter, eventsPage's
    // T-MEMORY-051 filter) treats a role=member user identically whether
    // they're connected via browser, personal token, or an OAuth client --
    // closing the gap where the same user's OAuth connector saw every
    // project system-wide instead of just their own memberships. Safe to
    // widen this way: the one consumer that must NOT treat an OAuth-derived
    // identity like a real session -- git-credential management's
    // requireSessionUserId() -- checks sessionSource === "cookie"
    // specifically, not just sessionUserId presence, and "oauth" below never
    // satisfies that.
    sessionUserId: identity?.userId ?? oauthOwner?.userId,
    sessionRole: identity?.role ?? oauthOwner?.role,
    sessionSource: sessionAuth ? "cookie" : personalTokenAuth ? "personal_token" : oauthOwner ? "oauth" : undefined,
    // The real Marrow user behind an OAuth-sourced request specifically --
    // kept as its own field (distinct from sessionUserId above, even though
    // sessionUserId now also carries it) because touchClient() (base.ts)
    // wants "was this OAuth" for gateway_clients attribution, not just "do
    // we know who this is".
    ownerUserId: oauthOwner?.userId
  };
}

function parseRequestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? "/", "http://gateway.local");
}

function queryString(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  return value && value.length > 0 ? value : undefined;
}

function headerString(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function isAuthorized(
  options: GatewayServerOptions,
  request: IncomingMessage,
  sessionAuth: SessionIdentity | null,
  personalTokenAuth: SessionIdentity | null
): AuthorizationState {
  if (options.token && request.headers.authorization === `Bearer ${options.token}`) {
    return { ok: true, source: "static" };
  }

  if (sessionAuth) {
    return { ok: true, source: "session" };
  }

  if (personalTokenAuth) {
    return { ok: true, source: "personal_token" };
  }

  if (options.oauth) {
    const auth = options.oauth.authenticate(request);
    if (auth.ok) {
      return { ok: true, source: "oauth" };
    }
    return {
      ok: false,
      kind: "unauthenticated",
      reason: auth.reason,
      challenge: options.oauth.challengeHeader(defaultOAuthScopes(), options.oauth.resourceForPath(parseRequestUrl(request).pathname))
    };
  }

  if (!options.token) {
    return { ok: true, source: "none" };
  }

  return { ok: false, kind: "unauthenticated", reason: "missing_static_token" };
}

// A Marrow user's identity as resolved from an OAuth bearer's `sub` claim
// (auth.ts's identifyOAuthOwner), fresh on every request -- never cached in
// the token itself, see resolveOAuthOwner below.
type OAuthOwner = { userId: string; role: string };

// Scope tier granted by a request that already passed isAuthorized(). Static
// token and no-token ("none") are fixed ceilings; a session's tier is
// role-derived (decision 1 in D-MEMORY-007: no separate "elevate to admin"
// UX, PMemUI has no destructive UI anyway per D-MEMORY-015). An OAuth
// bearer's tier is role-derived the same way (T-MEMORY-0xx SSO) -- it IS a
// specific Marrow user, connecting through a connector instead of a browser
// tab or CLI, and its tier tracks that user's CURRENT role exactly like a
// session/personal token's does. See the scope-resolution table in
// docs/AUTH.md.
function resolveScopeTier(
  auth: Extract<AuthorizationState, { ok: true }>,
  sessionAuth: SessionIdentity | null,
  personalTokenAuth: SessionIdentity | null,
  oauthOwner: OAuthOwner | null
): ScopeTier {
  switch (auth.source) {
    case "static":
    case "none":
      return "admin";
    case "session":
      return sessionAuth?.role === "admin" ? "admin" : "write";
    case "personal_token":
      // T-MEMORY-047: same role-derived resolution as a session -- a
      // personal token IS that specific user, connecting programmatically.
      return personalTokenAuth?.role === "admin" ? "admin" : "write";
    case "oauth":
      // A null oauthOwner (sub doesn't resolve to an active user) is
      // handled by the caller (isAuthorizedForScopes) as a 401 before this
      // is ever reached for that case -- treated as "write" here only as a
      // defensive fallback, never actually returned to a real caller.
      return oauthOwner?.role === "admin" ? "admin" : "write";
  }
}

function insufficientScope(requiredTier: ScopeTier, grantedTier: ScopeTier): AuthorizationState {
  return { ok: false, kind: "insufficient_scope", requiredTier, grantedTier };
}

async function isAuthorizedForScopes(
  options: GatewayServerOptions,
  request: IncomingMessage,
  auth: AuthorizationState,
  sessionAuth: SessionIdentity | null,
  personalTokenAuth: SessionIdentity | null,
  oauthOwner: OAuthOwner | null,
  requiredScopes: string[]
): Promise<AuthorizationState> {
  if (!auth.ok) {
    return auth;
  }

  if (auth.source === "oauth") {
    if (!options.oauth) {
      return auth;
    }
    if (requiredScopes.includes(ADMIN_SCOPE)) {
      // T-MEMORY-0xx SSO: a real admin-role user's own OAuth bearer reaches
      // admin-tier tools directly, mirroring how a session/personal token's
      // role resolves to admin tier -- no elevation header needed in that
      // case. Still independently re-checks the base bearer's own
      // signature/exp/resource validity (baseAuth) before trusting it.
      if (oauthOwner?.role === "admin") {
        const baseAuth = options.oauth.authenticate(
          request,
          requiredScopes.filter((scope) => scope !== ADMIN_SCOPE)
        );
        if (baseAuth.ok) {
          return auth;
        }
      }
      // Defense in depth on top of oauth.ts never issuing memory:admin:
      // even if a token somehow carried it, an OAuth-sourced request is
      // denied without inspecting the claim -- UNLESS this request also
      // carries a valid step-up elevation grant (T-MEMORY-041,
      // D-MEMORY-019). No elevation header at all is the cheap, common
      // case and short-circuits exactly like before this task. Untouched by
      // the SSO task above: a non-admin OAuth user (or one whose subject
      // didn't resolve at all) still needs this grant, exactly as before.
      const elevationToken = headerString(request, ELEVATION_HEADER);
      if (!elevationToken || !options.auth) {
        return insufficientScope("admin", "write");
      }
      // The grant only ever stands in for the missing memory:admin claim,
      // never for a missing/expired/invalid bearer -- the token's own
      // read+write scopes are still checked independently here.
      const baseAuth = options.oauth.authenticate(
        request,
        requiredScopes.filter((scope) => scope !== ADMIN_SCOPE)
      );
      if (!baseAuth.ok) {
        return insufficientScope("admin", "write");
      }
      const grant = await options.auth.consumeElevation(elevationToken);
      return grant.ok ? auth : insufficientScope("admin", "write");
    }

    if (!oauthOwner) {
      // sub doesn't resolve to an active user -- a disabled/deleted
      // account, or a still-valid pre-migration token whose sub was the old
      // hardcoded "project-memory-user" literal. Fail closed (401) rather
      // than silently downgrading to write scope.
      return {
        ok: false,
        kind: "unauthenticated",
        reason: "invalid_subject",
        challenge: options.oauth.challengeHeader(requiredScopes, options.oauth.resourceForPath(parseRequestUrl(request).pathname))
      };
    }
    // Falls through to the shared role-derived tier check below, exactly
    // like session/personal_token -- the JWT's own `scope` claim no longer
    // drives this decision (see oauth.ts's validateAuthorizeParams).
  }

  const grantedTier = resolveScopeTier(auth, sessionAuth, personalTokenAuth, oauthOwner);
  const grantedScopes = scopesForTier(grantedTier);
  const missing = requiredScopes.filter((scope) => !grantedScopes.includes(scope));
  if (missing.length === 0) {
    return auth;
  }
  return insufficientScope(requiredTierFor(requiredScopes), grantedTier);
}

// Resolves an OAuth bearer's identity, fresh, once per request: structural
// token validity (signature/exp/resource -- empty requiredScopes here since
// the JWT's own `scope` claim no longer drives the authorization decision,
// see resolveScopeTier's oauth case above) plus a live `users` lookup on its
// `sub`. Returns null for anything that isn't a currently-valid OAuth
// bearer for an active user -- including "there's no bearer at all" (same
// graceful-null shape as identifyFromRequest/identifyPersonalToken for a
// request with no cookie/token), not just a resolution failure.
async function resolveOAuthOwner(options: GatewayServerOptions, request: IncomingMessage): Promise<OAuthOwner | null> {
  if (!options.oauth || !options.auth) {
    return null;
  }
  const baseAuth = options.oauth.authenticate(request, []);
  if (!baseAuth.ok) {
    return null;
  }
  return options.auth.identifyOAuthOwner(baseAuth.subject);
}

function defaultOAuthScopes(): string[] {
  return ["memory:read", "memory:write"];
}

function protectedResourceFromRequestPath(oauth: OAuthFacade, requestPath: string): string | undefined {
  const prefix = "/.well-known/oauth-protected-resource";
  if (requestPath === prefix) {
    return undefined;
  }
  return oauth.resourceFromMetadataPath(requestPath.slice(prefix.length));
}

function isGraphqlRequestPath(requestPath: string): boolean {
  if (requestPath === "/graphql") {
    return true;
  }
  const endpoint = normalizedApiEndpoint();
  return Boolean(endpoint && requestPath === `${endpoint}/graphql`);
}

function normalizedApiEndpoint(): string | null {
  const raw = process.env.API_ENDPOINT?.trim();
  if (!raw || raw === "/") {
    return null;
  }
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const raw = await readText(request);
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams(await readText(request));
}

function formLogBody(form: URLSearchParams): unknown {
  const record: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    const safeValue = isSensitiveFormKey(key) ? "[REDACTED]" : value;
    if (record[key] === undefined) {
      record[key] = safeValue;
    } else if (Array.isArray(record[key])) {
      (record[key] as unknown[]).push(safeValue);
    } else {
      record[key] = [record[key], safeValue];
    }
  }
  return sanitizeLogBody(record);
}

async function readText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, status: number, body: unknown, requestId: string): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

type AuthFailure = Extract<AuthorizationState, { ok: false }>;

// Two genuinely different failures, kept visibly distinct end to end (REST,
// GraphQL, MCP): "unauthenticated" (401, generic -- deliberately vague about
// why, same as before this task) vs "insufficient_scope" (403, names both
// the required and granted tier). Acceptance criteria: a write-only
// credential hitting an admin-tier operation must get a clear scope error,
// not the same generic 401 an actually-missing/invalid credential gets.
function authFailureStatus(auth: AuthFailure): number {
  return auth.kind === "insufficient_scope" ? 403 : 401;
}

function authFailureError(auth: AuthFailure): AppError {
  if (auth.kind === "insufficient_scope" && auth.requiredTier && auth.grantedTier) {
    return new AppError(
      "INSUFFICIENT_SCOPE",
      `This operation requires ${auth.requiredTier} scope; your credential has ${auth.grantedTier}.`,
      { requiredScope: auth.requiredTier, grantedScope: auth.grantedTier }
    );
  }
  return new AppError("UNAUTHORIZED", "Missing or invalid gateway token.");
}

function sendUnauthorized(response: ServerResponse, requestId: string, auth: AuthFailure): void {
  const body = fail(authFailureError(auth));
  const payload = JSON.stringify(body);
  const headers: Record<string, string | number> = {
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
    "content-length": Buffer.byteLength(payload)
  };
  if (auth.challenge) {
    headers["www-authenticate"] = auth.challenge;
  }
  response.writeHead(authFailureStatus(auth), headers);
  response.end(payload);
}

function sendMcpUnauthorized(response: ServerResponse, requestId: string, auth: AuthFailure): void {
  const error = authFailureError(auth);
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    error: {
      // -32001 (existing code): no valid credential / missing OAuth scope
      // entirely. -32002 (new): credential is valid but its tier is too low
      // -- a distinct code so MCP clients can tell the two apart too.
      code: auth.kind === "insufficient_scope" ? -32002 : -32001,
      message: error.message
    },
    id: null
  });
  const headers: Record<string, string | number> = {
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
    "content-length": Buffer.byteLength(payload)
  };
  if (auth.challenge) {
    headers["www-authenticate"] = auth.challenge;
  }
  response.writeHead(authFailureStatus(auth), headers);
  response.end(payload);
}

function clientIp(request: IncomingMessage): string {
  return headerString(request, "x-forwarded-for")?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
}

function sanitizeLogBody(value: unknown): unknown {
  const sanitized = sanitizeLogValue(value);
  const serialized = JSON.stringify(sanitized);
  const maxChars = numberEnv("LOG_BODY_MAX_CHARS", 6000, 500, 100000);
  if (serialized.length <= maxChars) {
    return sanitized;
  }
  return {
    truncated: true,
    maxChars,
    chars: serialized.length,
    preview: serialized.slice(0, maxChars)
  };
}

function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return "[MaxDepth]";
  }
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeLogString(value);
  }
  if (Array.isArray(value)) {
    const maxItems = numberEnv("LOG_ARRAY_MAX_ITEMS", 30, 1, 500);
    const items = value.slice(0, maxItems).map((item) => sanitizeLogValue(item, depth + 1));
    if (value.length > maxItems) {
      items.push(`[${value.length - maxItems} more items]`);
    }
    return items;
  }
  if (!isRecord(value)) {
    return String(value);
  }

  const maxKeys = numberEnv("LOG_OBJECT_MAX_KEYS", 80, 1, 1000);
  const entries = Object.entries(value);
  const output: Record<string, unknown> = {};
  for (const [key, fieldValue] of entries.slice(0, maxKeys)) {
    output[key] = sanitizeLogField(key, fieldValue, depth + 1);
  }
  if (entries.length > maxKeys) {
    output._omittedKeys = entries.length - maxKeys;
  }
  return output;
}

function sanitizeLogField(key: string, value: unknown, depth: number): unknown {
  if (isBase64ContentKey(key)) {
    const chars = typeof value === "string" ? value.length : undefined;
    return chars === undefined ? "[BASE64_OMITTED]" : `[BASE64_OMITTED chars=${chars}]`;
  }
  if (isSensitiveKey(key)) {
    return "[REDACTED]";
  }
  return sanitizeLogValue(value, depth);
}

function sanitizeLogString(value: string): string {
  const redacted = redactSensitiveLogText(value);
  const maxChars = numberEnv("LOG_FIELD_MAX_CHARS", 1200, 80, 20000);
  if (redacted.length <= maxChars) {
    return redacted;
  }
  return `${redacted.slice(0, maxChars)}...[truncated chars=${redacted.length}]`;
}

function redactSensitiveLogText(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s"'`]+/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|token|secret|password|private[_-]?key|client[_-]?secret)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1[REDACTED]"
    )
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]"
    );
}

function isSensitiveFormKey(key: string): boolean {
  return ["code", "code_verifier", "client_secret", "password"].includes(key.toLowerCase());
}

function isSensitiveKey(key: string): boolean {
  return /authorization|cookie|token|secret|password|private[_-]?key|api[_-]?key|client[_-]?secret|code_verifier|magic/i.test(
    key
  );
}

function isBase64ContentKey(key: string): boolean {
  return key.toLowerCase() === "contentbase64";
}

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function logRequest(
  options: GatewayServerOptions,
  request: IncomingMessage,
  status: number,
  durationMs: number,
  requestId: string,
  context: GatewayRequestContext,
  extra: LogFields = {}
): void {
  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  options.logger?.[level](
    {
      requestId,
      method: request.method,
      url: request.url,
      status,
      durationMs,
      clientId: context.clientId,
      ...extra
    },
    "gateway request completed"
  );
}
