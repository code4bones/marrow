import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  dbPath: string;
  migrationsDir: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const packageRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

  return {
    dbPath: resolve(env.PROJECT_MEMORY_DB ?? ".agent/project-memory.sqlite"),
    migrationsDir: resolve(env.PROJECT_MEMORY_MIGRATIONS_DIR ?? resolve(packageRoot, "migrations")),
    logLevel: env.PROJECT_MEMORY_LOG_LEVEL ?? "info"
  };
}

function findPackageRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    if (existsSync(resolve(current, "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}
