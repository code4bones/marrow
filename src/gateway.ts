#!/usr/bin/env node
import { startGatewayServer } from "./gateway/http-server.js";
import { PgToolService } from "./gateway/pg-tool-service.js";
import { createGatewayLogger } from "./shared/logging/logger.js";
import { createPgKnex } from "./shared/pg/knex.js";

async function main(): Promise<void> {
  const logger = createGatewayLogger({
    level: process.env.PROJECT_MEMORY_LOG_LEVEL ?? "info",
    console: envFlag(process.env.PROJECT_MEMORY_LOG_CONSOLE, true),
    filePath: envFilePath(process.env.PROJECT_MEMORY_LOG_FILE, ".agent/project-memory-gateway.log")
  });
  const db = createPgKnex();
  const service = new PgToolService(db);
  const host = process.env.PROJECT_MEMORY_GATEWAY_HOST ?? "127.0.0.1";
  const port = Number(process.env.PROJECT_MEMORY_GATEWAY_PORT ?? process.env.PORT ?? 8765);
  const token = process.env.PROJECT_MEMORY_GATEWAY_TOKEN ?? process.env.MCP_TOKEN;
  const started = await startGatewayServer(service, { host, port, token, logger });

  logger.info(
    {
      url: started.url,
      logFile: envFilePath(process.env.PROJECT_MEMORY_LOG_FILE, ".agent/project-memory-gateway.log") || null
    },
    "project memory gateway listening"
  );

  const shutdown = async () => {
    logger.info("project memory gateway shutting down");
    await new Promise<void>((resolve) => started.server.close(() => resolve()));
    await service.close();
    logger.flush();
  };

  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}

main().catch((error: unknown) => {
  const logger = createGatewayLogger({
    level: process.env.PROJECT_MEMORY_LOG_LEVEL ?? "info",
    console: envFlag(process.env.PROJECT_MEMORY_LOG_CONSOLE, true),
    filePath: envFilePath(process.env.PROJECT_MEMORY_LOG_FILE, ".agent/project-memory-gateway.log")
  });
  logger.fatal({ error }, "project memory gateway failed to start");
  logger.flush();
  process.exit(1);
});

function envFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function envFilePath(value: string | undefined, defaultValue: string): string | false {
  if (value === undefined || value.length === 0) {
    return defaultValue;
  }
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }
  return value;
}
