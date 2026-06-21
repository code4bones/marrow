import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asMcpResult } from "../shared/mcp/tool-response.js";
import { defaultGatewayOutputSchema, gatewayToolSpecs } from "./tool-definitions.js";
import type { GatewayRequestContext, PgToolService } from "./pg-tool-service.js";

export function createGatewayMcpServer(service: PgToolService, context: GatewayRequestContext): McpServer {
  const server = new McpServer({
    name: "project-memory-gateway",
    version: "0.1.0"
  });

  for (const spec of gatewayToolSpecs) {
    server.registerTool(
      spec.name,
      {
        description: spec.description,
        inputSchema: spec.schema.shape,
        outputSchema: spec.outputSchema ?? defaultGatewayOutputSchema
      },
      async (input) => asMcpResult(await service.call(spec.name, input, context))
    );
  }

  return server;
}
