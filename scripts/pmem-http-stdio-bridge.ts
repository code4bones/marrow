#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type ServerResult
} from "@modelcontextprotocol/sdk/types.js";

const endpoint = process.env.PMEM_MCP_URL;
const token = process.env.PMEM_MCP_TOKEN ?? process.env.MCP_TOKEN;

if (!endpoint) {
  console.error("PMEM_MCP_URL is required, for example https://pmem.undoo.ru/api/mcp?client_id=... .");
  process.exit(1);
}

if (!token) {
  console.error("PMEM_MCP_TOKEN is required.");
  process.exit(1);
}

const remoteClient = new Client({
  name: "project-memory-http-stdio-bridge",
  version: "0.1.0"
});

const localServer = new Server(
  {
    name: "project-memory-http-stdio-bridge",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    },
    instructions:
      "Local stdio bridge for Project Memory MCP. It forwards tool listing and tool calls to the configured Streamable HTTP gateway."
  }
);

localServer.setRequestHandler(ListToolsRequestSchema, async (request) => {
  return remoteClient.listTools(request.params) as Promise<ServerResult>;
});

localServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  return remoteClient.callTool(request.params) as Promise<ServerResult>;
});

const remoteTransport = new StreamableHTTPClientTransport(new URL(endpoint), {
  requestInit: {
    headers: {
      authorization: `Bearer ${token}`
    }
  }
});

const localTransport = new StdioServerTransport();

try {
  await remoteClient.connect(remoteTransport);
  await localServer.connect(localTransport);
  console.error("Project Memory HTTP stdio bridge running.");
} catch (error) {
  console.error(error);
  await cleanup();
  process.exit(1);
}

process.once("SIGINT", () => {
  void cleanup().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void cleanup().finally(() => process.exit(0));
});

async function cleanup(): Promise<void> {
  await Promise.allSettled([localServer.close(), remoteClient.close()]);
}
