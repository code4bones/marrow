import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asMcpResult } from "../shared/mcp/tool-response.js";
import { readPackageMetadata } from "./pg-tool-service/formatters/gateway-ops.js";
import { defaultGatewayOutputSchema, gatewayToolClaudeName, gatewayToolSpecs } from "./tool-definitions.js";
import type { GatewayRequestContext, PgToolService } from "./pg-tool-service.js";

export async function createGatewayMcpServer(service: PgToolService, context: GatewayRequestContext): Promise<McpServer> {
  // Owner's ask (2026-09-13): this was hardcoded "0.1.0" forever, unrelated
  // to the real deployed backend version gateway.version already reports
  // (packageMetadata.version, read from the same package.json) -- the two
  // should obviously agree, not drift apart forever.
  const packageMetadata = await readPackageMetadata();
  const server = new McpServer({
    name: "project-memory-gateway",
    title: "Marrow",
    version: packageMetadata.version,
    websiteUrl: "https://marrow.undoo.ru",
    description: "Shared MCP memory gateway and local-first project memory server for coding agents.",
    // Owner's ask (2026-09-13): the connector showed a generic default icon
    // in Claude.ai's connector list after auth, even though the web app has
    // real branding. That list reads this `serverInfo` from the MCP
    // `initialize` response, not the OAuth authorize page (which already
    // used the web app's own branded UI, hence looking fine) -- `icons` is
    // part of the MCP spec's ImplementationSchema (SDK 1.30+) but was never
    // populated. Points at the already-deployed front/public/ PWA icon
    // (served statically by the same nginx that serves the web app) rather
    // than adding a new backend route for it.
    icons: [
      { src: "https://marrow.undoo.ru/pwa-icon-512.png", mimeType: "image/png", sizes: ["512x512"] },
      { src: "https://marrow.undoo.ru/pwa-icon-192.png", mimeType: "image/png", sizes: ["192x192"] },
      { src: "https://marrow.undoo.ru/favicon.svg", mimeType: "image/svg+xml" }
    ]
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
