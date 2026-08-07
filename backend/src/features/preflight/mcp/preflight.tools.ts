import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asMcpResult, fail, ok } from "../../../shared/mcp/tool-response.js";
import { preflightSchema } from "../model/schema.js";
import type { PreflightService } from "../service/preflight.service.js";

export function registerPreflightTool(server: McpServer, preflight: PreflightService): void {
  server.registerTool(
    "preflight",
    {
      description:
        "Return compact execution context for a task, including knownFaults that should stop repeated mistakes. Use immediately before editing files. Typical chain: project.current -> task.next/task.get -> preflight -> implement within allowed scope.",
      inputSchema: preflightSchema.shape
    },
    async (input) => {
      try {
        const result = preflight.run(preflightSchema.parse(input));
        return asMcpResult(ok(`Preflight context loaded for ${result.task.id}.`, result));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );
}
