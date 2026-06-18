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
      description: "Create a typed memory item.",
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
      description: "Get a memory item by id.",
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
      description: "Search memory items across the current project and common knowledge.",
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
      description: "Update a memory item.",
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
