import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asMcpResult } from "../shared/mcp/tool-response.js";
import { defaultGatewayOutputSchema, gatewayToolClaudeName, gatewayToolSpecs } from "./tool-definitions.js";
import type { GatewayRequestContext, PgToolService } from "./pg-tool-service.js";

export function createGatewayMcpServer(service: PgToolService, context: GatewayRequestContext): McpServer {
  const server = new McpServer({
    name: "project-memory-gateway",
    version: "0.1.0"
  });

  const useClaudeSafeNames = shouldUseClaudeSafeToolNames(context);
  for (const spec of gatewayToolSpecs) {
    const transportName = useClaudeSafeNames ? gatewayToolClaudeName(spec.name) : spec.name;
    server.registerTool(
      transportName,
      {
        description: useClaudeSafeNames ? `${spec.description} Canonical marrow tool: ${spec.name}.` : spec.description,
        inputSchema: spec.schema.shape,
        outputSchema: spec.outputSchema ?? defaultGatewayOutputSchema
      },
      async (input) => asMcpResult(await service.call(spec.name, input, context))
    );
  }

  return server;
}

function shouldUseClaudeSafeToolNames(context: GatewayRequestContext): boolean {
  const kind = typeof context.metadata?.kind === "string" ? context.metadata.kind : "";
  const userAgent = typeof context.metadata?.userAgent === "string" ? context.metadata.userAgent : "";
  return /claude/i.test(kind) || /claude/i.test(userAgent);
}
