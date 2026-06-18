import { resolve } from "node:path";

export interface AppConfig {
  dbPath: string;
  migrationsDir: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    dbPath: resolve(env.PROJECT_MEMORY_DB ?? ".agent/project-memory.sqlite"),
    migrationsDir: resolve("migrations"),
    logLevel: env.PROJECT_MEMORY_LOG_LEVEL ?? "info"
  };
}
