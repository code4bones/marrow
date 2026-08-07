import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asMcpResult, fail, ok } from "../../../shared/mcp/tool-response.js";
import { createLinkSchema, listLinksSchema } from "../model/schema.js";
import type { LinkService } from "../service/link.service.js";

export function registerLinkTools(server: McpServer, links: LinkService): void {
  server.registerTool(
    "link.create",
    {
      description:
        "Create a lightweight relationship between records such as task depends_on decision, failed_attempt warns_against task, or item relates_to entity. Use links to preserve navigable context without duplicating records.",
      inputSchema: createLinkSchema.shape
    },
    async (input) => {
      try {
        const link = links.create(createLinkSchema.parse(input));
        return asMcpResult(ok(`Link ${link.id} created.`, { link }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "link.list",
    {
      description:
        "List links for a record in from, to, or both directions. Use after task.get, decision.get, memory.get, or preflight to discover related constraints, dependencies, warnings, and context.",
      inputSchema: listLinksSchema.shape
    },
    async (input) => {
      try {
        const linkList = links.list(listLinksSchema.parse(input));
        return asMcpResult(ok(`${linkList.length} link(s) listed.`, { links: linkList }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );
}
