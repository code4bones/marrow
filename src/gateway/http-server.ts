import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AppError } from "../shared/errors.js";
import { fail } from "../shared/mcp/tool-response.js";
import type { GatewayRequestContext, PgToolService } from "./pg-tool-service.js";
import type { AppLogger } from "../shared/logging/logger.js";
import { createGatewayMcpServer } from "./mcp-server.js";

export interface GatewayServerOptions {
  host: string;
  port: number;
  logger?: AppLogger;
  token?: string;
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
  const context = requestContext(request);

  const send = (status: number, body: unknown) => {
    sendJson(response, status, body, requestId);
    logRequest(options, request, status, Date.now() - startedAt, requestId, context);
  };

  try {
    if (!isAuthorized(options, request)) {
      send(401, fail(new AppError("UNAUTHORIZED", "Missing or invalid gateway token.")));
      return;
    }

    if (request.url === "/mcp") {
      await handleMcpRequest(service, options, request, response, requestId, context, startedAt);
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      send(200, { ok: true, service: "project-memory-gateway" });
      return;
    }

    if (request.method === "GET" && request.url === "/ready") {
      const readiness = await service.readiness();
      send(readiness.ok ? 200 : 503, readiness);
      return;
    }

    if (request.method === "GET" && request.url === "/tools") {
      send(200, { ok: true, tools: service.listTools() });
      return;
    }

    if (request.method === "POST" && request.url === "/call") {
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

function requestContext(request: IncomingMessage): GatewayRequestContext {
  const clientId = headerString(request, "x-project-memory-client-id") ?? "anonymous";
  const clientLabel = headerString(request, "x-project-memory-client-label") ?? clientId;
  return {
    clientId,
    clientLabel,
    metadata: {
      kind: headerString(request, "x-project-memory-client-kind") ?? "http",
      userAgent: headerString(request, "user-agent")
    }
  };
}

function headerString(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function isAuthorized(options: GatewayServerOptions, request: IncomingMessage): boolean {
  if (!options.token) {
    return true;
  }
  return request.headers.authorization === `Bearer ${options.token}`;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
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
