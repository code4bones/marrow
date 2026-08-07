import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fail, ok, asMcpResult } from "../../../shared/mcp/tool-response.js";
import {
  createMemorySchema,
  getMemorySchema,
  searchMemorySchema,
  updateMemorySchema
} from "../model/schema.js";
import type { MemoryService } from "../service/memory.service.js";

export function registerMemoryTools(server: McpServer, memory: MemoryService): void {
  server.registerTool(
    "memory.create",
    {
      description:
        "Create a typed memory item. Use project/common records for reusable context, notes, patterns, entities, failed_attempt records, and agent/workflow rules. Creates item.created event automatically.",
      inputSchema: createMemorySchema.shape
    },
    async (input) => {
      try {
        const item = memory.create(createMemorySchema.parse(input));
        return asMcpResult(ok(`Memory item ${item.id} created.`, { item }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "memory.get",
    {
      description:
        "Get a memory item by id when search, preflight, or links return an item id and the full body/tags/status are needed.",
      inputSchema: getMemorySchema.shape
    },
    async (input) => {
      try {
        const parsed = getMemorySchema.parse(input);
        const item = memory.get(parsed.id);
        return asMcpResult(ok(`Memory item ${item.id} loaded.`, { item }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "memory.search",
    {
      description:
        "Search typed memory items with FTS5. Default workflow is current project plus common knowledge. Use before planning or editing when you need relevant rules, notes, failed attempts, patterns, or project facts.",
      inputSchema: searchMemorySchema.shape
    },
    async (input) => {
      try {
        const results = memory.search(searchMemorySchema.parse(input));
        return asMcpResult(ok(`${results.length} memory result(s) found.`, { results }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "memory.update",
    {
      description:
        "Update a memory item title/body/status/tags. Use to refine stale records, archive/supersede items, or add better context after work. Creates item.updated event automatically.",
      inputSchema: updateMemorySchema.shape
    },
    async (input) => {
      try {
        const item = memory.update(updateMemorySchema.parse(input));
        return asMcpResult(ok(`Memory item ${item.id} updated.`, { item }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );
}
