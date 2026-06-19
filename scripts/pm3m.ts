#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPgKnex } from "../src/shared/pg/knex.js";

const packageRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
const command = process.argv[2] ?? "help";

try {
  switch (command) {
    case "start":
      startPm2();
      break;
    case "migrate":
      await runMigrations(process.argv[3] ?? "latest");
      break;
    case "status":
      await runMigrations("status");
      break;
    case "rollback":
      await runMigrations("rollback");
      break;
    case "gateway":
      await import(pathToGatewayImport());
      break;
    case "stdio":
      await import(pathToStdioImport());
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      throw new Error(`Unknown command "${command}". Run "pm3m help".`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function startPm2(): void {
  const deployDir = process.cwd();
  const gatewayScript = path.resolve(packageRoot, "dist", "src", "gateway.js");
  const ecosystemPath = path.resolve(deployDir, ".pm3m.ecosystem.cjs");
  const processName = process.env.PM2_NAME ?? "pm3m-gateway";

  if (!existsSync(path.resolve(deployDir, ".env"))) {
    throw new Error(`.env not found in ${deployDir}. Run "pm3m start" from the gateway deployment directory.`);
  }

  if (!existsSync(gatewayScript)) {
    throw new Error(`Gateway entrypoint not found: ${gatewayScript}`);
  }

  writeFileSync(ecosystemPath, ecosystemFile(gatewayScript, processName));
  execFileSync("pm2", ["startOrReload", ecosystemPath, "--env", "production"], {
    stdio: "inherit"
  });
  console.log(`pm3m gateway process configured from ${ecosystemPath}.`);
}

async function runMigrations(action: string): Promise<void> {
  dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

  const migrationsDir = path.resolve(packageRoot, "migrations", "pg");
  const db = createPgKnex();
  try {
    switch (action) {
      case "latest": {
        const [batchNo, migrations] = await db.migrate.latest({
          directory: migrationsDir,
          tableName: "knex_migrations"
        });
        console.log(`Applied migration batch ${batchNo}.`);
        if (migrations.length === 0) {
          console.log("No pending migrations.");
        } else {
          for (const migration of migrations) {
            console.log(`- ${migration}`);
          }
        }
        break;
      }
      case "rollback": {
        const [batchNo, migrations] = await db.migrate.rollback(
          {
            directory: migrationsDir,
            tableName: "knex_migrations"
          },
          true
        );
        console.log(`Rolled back migration batch ${batchNo}.`);
        for (const migration of migrations) {
          console.log(`- ${migration}`);
        }
        break;
      }
      case "status": {
        const [completed, pending] = await db.migrate.list({
          directory: migrationsDir,
          tableName: "knex_migrations"
        });
        console.log(`Completed migrations: ${completed.length}`);
        for (const migration of completed) {
          console.log(`- ${migration.name}`);
        }
        console.log(`Pending migrations: ${pending.length}`);
        for (const migration of pending) {
          console.log(`- ${migration.file}`);
        }
        break;
      }
      default:
        throw new Error(`Unknown migration action "${action}". Use latest, status, or rollback.`);
    }
  } finally {
    await db.destroy();
  }
}

function pathToGatewayImport(): string {
  return pathToFileURL(path.resolve(packageRoot, "dist", "src", "gateway.js")).href;
}

function pathToStdioImport(): string {
  return pathToFileURL(path.resolve(packageRoot, "dist", "src", "index.js")).href;
}

function ecosystemFile(gatewayScript: string, processName: string): string {
  return `const fs = require("fs");
const path = require("path");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const env = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\\r?\\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const fileEnv = parseEnvFile(path.resolve(__dirname, ".env"));
const runtimeEnv = {
  ...process.env,
  ...fileEnv,
  NODE_ENV: "production",
  BIND: fileEnv.BIND || process.env.BIND || "127.0.0.1",
  PORT: fileEnv.PORT || process.env.PORT || "8765"
};

module.exports = {
  apps: [
    {
      name: ${JSON.stringify(processName)},
      cwd: __dirname,
      script: ${JSON.stringify(gatewayScript)},
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      watch: [".env"],
      ignore_watch: ["node_modules", ".git", ".agent", "logs", "artifacts"],
      watch_delay: 1000,
      max_memory_restart: "256M",
      time: false,
      env: runtimeEnv,
      env_production: runtimeEnv,
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 10,
      exp_backoff_restart_delay: 200
    }
  ]
};
`;
}

function printHelp(): void {
  console.log(`pm3m

Usage:
  pm3m start              Start or reload the PM2 gateway from the current .env directory
  pm3m migrate [latest]   Apply PostgreSQL migrations using .env from the current directory
  pm3m status             Show PostgreSQL migration status
  pm3m rollback           Roll back the latest PostgreSQL migration batch
  pm3m gateway            Run the gateway directly without PM2
  pm3m stdio              Run the local SQLite stdio MCP server
  pm3m help               Show this help
`);
}

function findPackageRoot(startDir: string): string {
  let current = startDir;
  while (true) {
    if (existsSync(path.resolve(current, "package.json"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Package root not found from ${startDir}.`);
    }
    current = parent;
  }
}
