#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AppError } from "./shared/errors.js";
import { asMcpResult, fail, type ToolResponse } from "./shared/mcp/tool-response.js";
import { gatewayToolSpecs } from "./gateway/tool-definitions.js";

async function main(): Promise<void> {
  const gatewayUrl = normalizeUrl(
    process.env.PROJECT_MEMORY_GATEWAY_URL ?? process.env.API_ENDPOINT ?? "http://127.0.0.1:8765"
  );
  const token = process.env.PROJECT_MEMORY_GATEWAY_TOKEN ?? process.env.MCP_TOKEN;
  const server = new McpServer({
    name: "project-memory-gateway-client",
    version: "0.1.0"
  });

  for (const spec of gatewayToolSpecs) {
    server.registerTool(
      spec.name,
      {
        description: spec.description,
        inputSchema: spec.schema.shape
      },
      async (input) => {
        try {
          return asMcpResult(await callGateway(gatewayUrl, token, spec.name, input));
        } catch (error) {
          return asMcpResult(fail(error));
        }
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Project Memory gateway MCP client connected to ${gatewayUrl}.`);
}

async function callGateway(
  gatewayUrl: string,
  token: string | undefined,
  tool: string,
  input: unknown
): Promise<ToolResponse<unknown>> {
  const response = await fetch(`${gatewayUrl}/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ tool, input })
  });

  const parsed = (await response.json()) as ToolResponse<unknown>;
  if (!response.ok) {
    throw new AppError("GATEWAY_ERROR", `Gateway returned HTTP ${response.status}.`, { response: parsed });
  }
  return parsed;
}

function normalizeUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
