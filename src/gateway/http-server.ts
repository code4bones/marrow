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
import { gatewayToolRequiredScopes } from "./tool-definitions.js";
import {
  createGatewayGraphqlServer,
  handleGatewayGraphqlRequest,
  type GatewayGraphqlServer
} from "./graphql.js";

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
  stop(): Promise<void>;
}

interface ToolCallBody {
  tool?: unknown;
  input?: unknown;
}

type LogFields = Record<string, unknown>;
type AuthorizationState =
  | { ok: true; source: "static" | "oauth" | "none" }
  | { ok: false; challenge?: string };

export async function startGatewayServer(
  service: PgToolService,
  options: GatewayServerOptions
): Promise<StartedGatewayServer> {
  const graphql = await createGatewayGraphqlServer();
  const server = createServer((request, response) => {
    void handleRequest(service, options, graphql, request, response);
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
    await graphql.stop();
    throw error;
  }

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  return {
    server,
    url: `http://${options.host}:${port}`,
    async stop() {
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
  const context = requestContext(request, requestId);

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

    if (options.oauth && request.method === "GET" && requestPath === "/oauth/authorize") {
      const result = options.oauth.authorizeForm(requestUrl);
      sendHtml(response, result.status, result.html, requestId);
      logRequest(options, request, result.status, Date.now() - startedAt, requestId, context);
      return;
    }

    if (options.oauth && request.method === "POST" && requestPath === "/oauth/authorize") {
      const form = await readForm(request);
      const logFields = {
        requestBody: formLogBody(form),
        oauthClientId: form.get("client_id") ?? undefined
      };
      const result = options.oauth.authorize(form, clientIp(request));
      if (result.status === 302) {
        response.writeHead(302, {
          location: result.location,
          "x-request-id": requestId
        });
        response.end();
        logRequest(options, request, 302, Date.now() - startedAt, requestId, context, logFields);
      } else {
        sendHtml(response, result.status, result.html, requestId);
        logRequest(options, request, result.status, Date.now() - startedAt, requestId, context, logFields);
      }
      return;
    }

    if (options.oauth && request.method === "POST" && requestPath === "/oauth/token") {
      const form = await readForm(request);
      const result = options.oauth.token(form, request);
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

    const auth = isAuthorized(options, request);
    if (!auth.ok) {
      sendUnauthorized(response, requestId, auth.challenge);
      logRequest(options, request, 401, Date.now() - startedAt, requestId, context);
      return;
    }

    if (isGraphqlRequestPath(requestPath)) {
      await handleGraphqlRequest(service, options, graphql, request, response, requestId, context, startedAt);
      return;
    }

    if (requestPath === "/mcp") {
      await handleMcpRequest(service, options, request, response, requestId, context, startedAt, auth);
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
      const scopeAuth = isAuthorizedForScopes(options, request, auth, gatewayToolRequiredScopes(body.tool));
      if (!scopeAuth.ok) {
        sendUnauthorized(response, requestId, scopeAuth.challenge);
        logRequest(options, request, 401, Date.now() - startedAt, requestId, context, {
          tool: body.tool,
          requestBody: sanitizeLogBody(body),
          requiredScopes: gatewayToolRequiredScopes(body.tool)
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
  startedAt: number
): Promise<void> {
  try {
    const result = await handleGatewayGraphqlRequest({
      graphql,
      request,
      response,
      requestContext: context,
      requestId,
      service,
      logger: options.logger
    });
    logRequest(options, request, result.status, Date.now() - startedAt, requestId, context, {
      graphqlOperationName: result.operationName
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
  auth: AuthorizationState
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
    const scopeAuth = isAuthorizedForScopes(options, request, auth, requiredScopes);
    if (!scopeAuth.ok) {
      sendMcpUnauthorized(response, requestId, scopeAuth.challenge);
      logRequest(options, request, 401, Date.now() - startedAt, requestId, context, {
        ...logFields,
        requiredScopes
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

function isAuthorized(options: GatewayServerOptions, request: IncomingMessage): AuthorizationState {
  if (options.token && request.headers.authorization === `Bearer ${options.token}`) {
    return { ok: true, source: "static" };
  }

  if (options.oauth) {
    const auth = options.oauth.authenticate(request);
    if (auth.ok) {
      return { ok: true, source: "oauth" };
    }
    return { ok: false, challenge: options.oauth.challengeHeader(["memory:read"], options.oauth.resourceForPath(parseRequestUrl(request).pathname)) };
  }

  if (!options.token) {
    return { ok: true, source: "none" };
  }

  return { ok: false };
}

function isAuthorizedForScopes(
  options: GatewayServerOptions,
  request: IncomingMessage,
  auth: AuthorizationState,
  requiredScopes: string[]
): AuthorizationState {
  if (!auth.ok || auth.source !== "oauth" || !options.oauth) {
    return auth;
  }
  const scopedAuth = options.oauth.authenticate(request, requiredScopes);
  if (scopedAuth.ok) {
    return auth;
  }
  return { ok: false, challenge: options.oauth.challengeHeader(requiredScopes, options.oauth.resourceForPath(parseRequestUrl(request).pathname)) };
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

function sendMcpUnauthorized(response: ServerResponse, requestId: string, challenge?: string): void {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: "Missing required OAuth scope."
    },
    id: null
  });
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
  return ["code", "code_verifier", "client_secret", "magic_token", "password"].includes(key.toLowerCase());
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
