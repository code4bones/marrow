#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { bootstrap } from "./app/bootstrap.js";
import { loadConfig } from "./app/config.js";

async function main(): Promise<void> {
  const app = bootstrap(loadConfig());
  const transport = new StdioServerTransport();
  await app.server.connect(transport);
  console.error("Project Memory MCP running on stdio.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
