#!/usr/bin/env node
import { startGatewayServer } from "./gateway/http-server.js";
import { PgToolService } from "./gateway/pg-tool-service.js";
import { createPgKnex } from "./shared/pg/knex.js";

async function main(): Promise<void> {
  const db = createPgKnex();
  const service = new PgToolService(db);
  const host = process.env.PROJECT_MEMORY_GATEWAY_HOST ?? "127.0.0.1";
  const port = Number(process.env.PROJECT_MEMORY_GATEWAY_PORT ?? process.env.PORT ?? 8765);
  const token = process.env.PROJECT_MEMORY_GATEWAY_TOKEN ?? process.env.MCP_TOKEN;
  const started = await startGatewayServer(service, { host, port, token });

  console.error(`Project Memory gateway listening at ${started.url}.`);

  const shutdown = async () => {
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
    await service.close();
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
