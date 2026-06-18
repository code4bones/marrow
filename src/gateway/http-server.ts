import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AppError } from "../shared/errors.js";
import { fail } from "../shared/mcp/tool-response.js";
import type { GatewayRequestContext, PgToolService } from "./pg-tool-service.js";

export interface GatewayServerOptions {
  host: string;
  port: number;
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
  try {
    if (!isAuthorized(options, request)) {
      sendJson(response, 401, fail(new AppError("UNAUTHORIZED", "Missing or invalid gateway token.")));
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { ok: true, service: "project-memory-gateway" });
      return;
    }

    if (request.method === "GET" && request.url === "/tools") {
      sendJson(response, 200, { ok: true, tools: service.listTools() });
      return;
    }

    if (request.method === "POST" && request.url === "/call") {
      const body = (await readJson(request)) as ToolCallBody;
      if (typeof body.tool !== "string") {
        sendJson(response, 400, fail(new AppError("VALIDATION_ERROR", "Request body must include a string tool.")));
        return;
      }
      sendJson(response, 200, await service.call(body.tool, body.input ?? {}, requestContext(request)));
      return;
    }

    sendJson(response, 404, fail(new AppError("NOT_FOUND", `Route ${request.method ?? "GET"} ${request.url ?? "/"} not found.`)));
  } catch (error) {
    sendJson(response, 500, fail(error));
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

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}
