import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { asMcpResult, fail, ok } from "../../../shared/mcp/tool-response.js";
import { listEventsSchema, recordEventSchema } from "../model/schema.js";
import type { EventService } from "../service/event.service.js";

export function registerEventTools(server: McpServer, events: EventService): void {
  server.registerTool(
    "event.record",
    {
      description: "Record an append-only project memory event.",
      inputSchema: recordEventSchema.shape
    },
    async (input) => {
      try {
        const event = events.record(recordEventSchema.parse(input));
        return asMcpResult(ok(`Event ${event.id} recorded.`, { event }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );

  server.registerTool(
    "event.list",
    {
      description: "List project memory events.",
      inputSchema: listEventsSchema.shape
    },
    async (input) => {
      try {
        const eventList = events.list(listEventsSchema.parse(input));
        return asMcpResult(ok(`${eventList.length} event(s) listed.`, { events: eventList }));
      } catch (error) {
        return asMcpResult(fail(error));
      }
    }
  );
}
