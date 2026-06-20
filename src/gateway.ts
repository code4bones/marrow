#!/usr/bin/env node
import dotenv from "dotenv";
import path from "node:path";
import { startGatewayServer } from "./gateway/http-server.js";
import { createOAuthFacadeFromEnv } from "./gateway/oauth.js";
import { PgToolService } from "./gateway/pg-tool-service.js";
import { createGatewayLogger } from "./shared/logging/logger.js";
import { createPgKnex } from "./shared/pg/knex.js";

dotenv.config({ quiet: true });

async function main(): Promise<void> {
  const logFile = envLogFile(process.env.LOG_DIR, "project-memory-gateway.log");
  const logger = createGatewayLogger({
    level: process.env.LOG_LEVEL ?? "info",
    filePath: logFile,
    pretty: envFlag(process.env.LOG_PRETTY, false),
    includeTime: envFlag(process.env.LOG_INCLUDE_TIME, true)
  });
  const db = createPgKnex();
  const service = new PgToolService(db);
  const host = process.env.BIND ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 8765);
  const token = process.env.MCP_TOKEN;
  const oauth = createOAuthFacadeFromEnv();
  const started = await startGatewayServer(service, { host, port, token, oauth, logger });

  logger.info(
    {
      url: started.url,
      logFile: logFile || null,
      oauth: Boolean(oauth)
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
  const logFile = envLogFile(process.env.LOG_DIR, "project-memory-gateway.log");
  const logger = createGatewayLogger({
    level: process.env.LOG_LEVEL ?? "info",
    filePath: logFile,
    pretty: envFlag(process.env.LOG_PRETTY, false),
    includeTime: envFlag(process.env.LOG_INCLUDE_TIME, true)
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

function envLogFile(value: string | undefined, fileName: string): string | false {
  if (value !== undefined && ["0", "false", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }
  return path.join(value && value.length > 0 ? value : ".agent", fileName);
}
