import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AppError } from "../shared/errors.js";
import { fail } from "../shared/mcp/tool-response.js";
import type { GatewayRequestContext, PgToolService } from "./pg-tool-service.js";
import type { AppLogger } from "../shared/logging/logger.js";
import { createGatewayMcpServer } from "./mcp-server.js";
import type { OAuthFacade } from "./oauth.js";

export interface GatewayServerOptions {
  host: string;
  port: number;
  logger?: AppLogger;
  token?: string;
  oauth?: OAuthFacade;
}

export interface StartedGatewayServer {
  server: Server;
  url: string;
}

interface ToolCallBody {
  tool?: unknown;
  input?: unknown;
}

export async function startGatewayServer(
  service: PgToolService,
  options: GatewayServerOptions
): Promise<StartedGatewayServer> {
  const server = createServer((request, response) => {
    void handleRequest(service, options, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return { server, url: `http://${options.host}:${port}` };
}

async function handleRequest(
  service: PgToolService,
  options: GatewayServerOptions,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const startedAt = Date.now();
  const requestId = request.headers["x-request-id"]?.toString() ?? randomUUID();
  const requestUrl = parseRequestUrl(request);
  const requestPath = requestUrl.pathname;
  const context = requestContext(request, requestId);

  const send = (status: number, body: unknown) => {
    sendJson(response, status, body, requestId);
    logRequest(options, request, status, Date.now() - startedAt, requestId, context);
  };

  try {
    if (options.oauth && request.method === "GET" && requestPath === "/.well-known/oauth-protected-resource") {
      send(200, options.oauth.metadata.protectedResource());
      return;
    }

    if (options.oauth && request.method === "GET" && requestPath === "/.well-known/oauth-authorization-server") {
      send(200, options.oauth.metadata.authorizationServer());
      return;
    }

    if (options.oauth && request.method === "GET" && requestPath === "/.well-known/jwks.json") {
      send(200, options.oauth.metadata.jwks());
      return;
    }

    if (options.oauth && request.method === "GET" && requestPath === "/oauth/authorize") {
      const result = options.oauth.authorizeForm(requestUrl);
      sendHtml(response, result.status, result.html, requestId);
      logRequest(options, request, result.status, Date.now() - startedAt, requestId, context);
      return;
    }

    if (options.oauth && request.method === "POST" && requestPath === "/oauth/authorize") {
      const result = options.oauth.authorize(await readForm(request), clientIp(request));
      if (result.status === 302) {
        response.writeHead(302, {
          location: result.location,
          "x-request-id": requestId
        });
        response.end();
        logRequest(options, request, 302, Date.now() - startedAt, requestId, context);
      } else {
        sendHtml(response, result.status, result.html, requestId);
        logRequest(options, request, result.status, Date.now() - startedAt, requestId, context);
      }
      return;
    }

    if (options.oauth && request.method === "POST" && requestPath === "/oauth/token") {
      const result = options.oauth.token(await readForm(request));
      send(result.status, result.body);
      return;
    }

    const auth = isAuthorized(options, request);
    if (!auth.ok) {
      sendUnauthorized(response, requestId, auth.challenge);
      logRequest(options, request, 401, Date.now() - startedAt, requestId, context);
      return;
    }

    if (requestPath === "/mcp") {
      await handleMcpRequest(service, options, request, response, requestId, context, startedAt);
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
        send(400, fail(new AppError("VALIDATION_ERROR", "Request body must include a string tool.")));
        return;
      }
      const toolStartedAt = Date.now();
      const result = await service.call(body.tool, body.input ?? {}, context);
      options.logger?.debug(
        {
          requestId,
          clientId: context.clientId,
          tool: body.tool,
          durationMs: Date.now() - toolStartedAt,
          ok: result.ok
        },
        "gateway tool call completed"
      );
      send(200, result);
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
  startedAt: number
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

  try {
    await server.connect(transport);
    await transport.handleRequest(request, response, await readJson(request));
    logRequest(options, request, response.statusCode, Date.now() - startedAt, requestId, context);
  } catch (error) {
    options.logger?.error({ requestId, clientId: context.clientId, error }, "gateway mcp request failed");
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
      logRequest(options, request, 500, Date.now() - startedAt, requestId, context);
    }
  } finally {
    await transport.close();
    await server.close();
  }
}

function requestContext(request: IncomingMessage, requestId: string): GatewayRequestContext {
  const requestUrl = parseRequestUrl(request);
  const explicitClientId = headerString(request, "x-project-memory-client-id") ?? queryString(requestUrl, "client_id");
  const clientId = explicitClientId ?? `anonymous:${requestId}`;
  const clientLabel =
    headerString(request, "x-project-memory-client-label") ??
    queryString(requestUrl, "client_label") ??
    (explicitClientId ? clientId : "anonymous");
  return {
    clientId,
    clientLabel,
    metadata: {
      anonymous: explicitClientId ? false : true,
      kind: headerString(request, "x-project-memory-client-kind") ?? queryString(requestUrl, "client_kind") ?? "http",
      userAgent: headerString(request, "user-agent")
    }
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
  request: IncomingMessage
): { ok: true } | { ok: false; challenge?: string } {
  if (options.token && request.headers.authorization === `Bearer ${options.token}`) {
    return { ok: true };
  }

  if (options.oauth) {
    const auth = options.oauth.authenticate(request);
    if (auth.ok) {
      return { ok: true };
    }
    return { ok: false, challenge: options.oauth.challengeHeader() };
  }

  if (!options.token) {
    return { ok: true };
  }

  return { ok: false };
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

function sendHtml(response: ServerResponse, status: number, body: string, requestId: string): void {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "x-request-id": requestId,
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function sendUnauthorized(response: ServerResponse, requestId: string, challenge?: string): void {
  const body = fail(new AppError("UNAUTHORIZED", "Missing or invalid gateway token."));
  const payload = JSON.stringify(body);
  const headers: Record<string, string | number> = {
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
    "content-length": Buffer.byteLength(payload)
  };
  if (challenge) {
    headers["www-authenticate"] = challenge;
  }
  response.writeHead(401, headers);
  response.end(payload);
}

function clientIp(request: IncomingMessage): string {
  return headerString(request, "x-forwarded-for")?.split(",")[0]?.trim() || request.socket.remoteAddress || "unknown";
}

function logRequest(
  options: GatewayServerOptions,
  request: IncomingMessage,
  status: number,
  durationMs: number,
  requestId: string,
  context: GatewayRequestContext
): void {
  const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
  options.logger?.[level](
    {
      requestId,
      method: request.method,
      url: request.url,
      status,
      durationMs,
      clientId: context.clientId
    },
    "gateway request completed"
  );
}
