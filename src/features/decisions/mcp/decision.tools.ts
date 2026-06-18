import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asMcpResult, fail, ok } from "../../../shared/mcp/tool-response.js";
import { getDecisionSchema, listDecisionsSchema, recordDecisionSchema } from "../model/schema.js";
import type { DecisionService } from "../service/decision.service.js";

export function registerDecisionTools(server: McpServer, decisions: DecisionService): void {
  server.registerTool(
    "decision.record",
    {
      description: "Record a project or common decision.",
      inputSchema: recordDecisionSchema.shape
    },
    async (input) => {
      try {
        const decision = decisions.record(recordDecisionSchema.parse(input));
        return asMcpResult(ok(`Decision ${decision.id} recorded.`, { decision }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "decision.list",
    {
      description: "List project and common decisions.",
      inputSchema: listDecisionsSchema.shape
    },
    async (input) => {
      try {
        const decisionList = decisions.list(listDecisionsSchema.parse(input));
        return asMcpResult(ok(`${decisionList.length} decision(s) listed.`, { decisions: decisionList }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "decision.get",
    {
      description: "Get a decision by id.",
      inputSchema: getDecisionSchema.shape
    },
    async (input) => {
      try {
        const parsed = getDecisionSchema.parse(input);
        const decision = decisions.get(parsed.id);
        return asMcpResult(ok(`Decision ${decision.id} loaded.`, { decision }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );
}
