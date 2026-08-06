#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPgKnex } from "../src/shared/pg/knex.js";
import { seedBundledTemplates } from "./seed-templates.js";

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
    case "seed":
      await runSeed(process.argv[3] ?? "templates");
      break;
    case "oauth":
      runOauth(process.argv[3] ?? "help");
      break;
    case "admin":
      await runAdmin(process.argv[3] ?? "help", process.argv.slice(4));
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
  const envPath = path.resolve(deployDir, ".env");
  const ecosystemPath = path.resolve(deployDir, ".pm3m.ecosystem.config.cjs");
  const processName = process.env.PM2_NAME ?? "pm3m-gateway";

  if (!existsSync(envPath)) {
    throw new Error(`.env not found in ${deployDir}. Run "pm3m start" from the gateway deployment directory.`);
  }

  if (!existsSync(gatewayScript)) {
    throw new Error(`Gateway entrypoint not found: ${gatewayScript}`);
  }

  writeFileSync(ecosystemPath, ecosystemFile(gatewayScript, processName));
  const runtimeEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...parseEnvFile(envPath),
    NODE_ENV: "production"
  };
  runtimeEnv.BIND = runtimeEnv.BIND || "127.0.0.1";
  runtimeEnv.PORT = runtimeEnv.PORT || "8765";

  try {
    execFileSync("pm2", ["startOrReload", ecosystemPath, "--env", "production"], {
      stdio: "inherit",
      env: runtimeEnv
    });
    console.log(`pm3m gateway process configured from ${ecosystemPath}.`);
  } catch (error) {
    console.warn("pm2 startOrReload failed; falling back to direct pm2 start.");
    if (error instanceof Error) {
      console.warn(error.message);
    }
    startPm2Direct(gatewayScript, processName, deployDir, runtimeEnv);
  }
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
        await seedBundledTemplates({ db, packageRoot, log: console.log });
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

async function runSeed(target: string): Promise<void> {
  dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

  switch (target) {
    case "templates":
      await seedBundledTemplates({ packageRoot, log: console.log });
      break;
    default:
      throw new Error(`Unknown seed target "${target}". Use templates.`);
  }
}

function runOauth(target: string): void {
  switch (target) {
    case "key":
      printOauthPrivateKey();
      break;
    case "help":
    case "--help":
    case "-h":
      printOauthHelp();
      break;
    default:
      throw new Error(`Unknown oauth target "${target}". Use key.`);
  }
}

async function runAdmin(action: string, args: string[]): Promise<void> {
  switch (action) {
    case "create":
      await createAdmin(args);
      break;
    case "help":
    case "--help":
    case "-h":
      printAdminHelp();
      break;
    default:
      throw new Error(`Unknown admin action "${action}". Use create.`);
  }
}

async function createAdmin(args: string[]): Promise<void> {
  dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

  const { email, force } = parseAdminCreateArgs(args);
  if (!email) {
    throw new Error(
      "pm3m admin create requires --email <address>. Example: pm3m admin create --email owner@example.com"
    );
  }

  const db = createPgKnex();
  try {
    const existingAdmin = await db("users").where({ role: "admin" }).first();
    if (existingAdmin && !force) {
      throw new Error(
        `An admin already exists (${existingAdmin.email}). Bootstrap is one-time; pass --force to create another admin anyway.`
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingByEmail = await db("users").where({ email: normalizedEmail }).first();
    if (existingByEmail) {
      throw new Error(`A user with email ${normalizedEmail} already exists (id ${existingByEmail.id}).`);
    }

    const now = new Date();
    const userId = randomUUID();
    await db("users").insert({
      id: userId,
      email: normalizedEmail,
      password_hash: null,
      // Shell access to the host that runs pm3m is a stronger trust signal
      // than clicking an email link, so the bootstrap admin's email is
      // considered verified immediately — see D-MEMORY-008.
      email_verified_at: now,
      totp_enabled: false,
      role: "admin",
      status: "active",
      created_at: now,
      updated_at: now
    });

    const rawToken = base64url(randomBytes(32));
    await db("tokens").insert({
      id: randomUUID(),
      user_id: userId,
      email: normalizedEmail,
      purpose: "password_reset",
      token_hash: sha256Hex(rawToken),
      expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      created_by: userId,
      created_at: now
    });

    const base = trimTrailingSlash(process.env.PROJECT_MEMORY_PUBLIC_URL ?? "");
    const claimPath = `/auth/claim?token=${rawToken}`;
    const link = base ? `${base}${claimPath}` : claimPath;

    console.log(`Admin user created: ${normalizedEmail} (${userId})`);
    console.log("One-time link to set a password (valid 24h, single use):");
    console.log(link);
    if (!base) {
      console.log("PROJECT_MEMORY_PUBLIC_URL is not set in .env — prepend your PMemUI base URL to the path above.");
    }
  } finally {
    await db.destroy();
  }
}

function parseAdminCreateArgs(args: string[]): { email?: string; force: boolean } {
  let email: string | undefined;
  let force = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--email") {
      email = args[i + 1];
      i += 1;
    } else if (arg === "--force") {
      force = true;
    }
  }
  return { email, force };
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function printAdminHelp(): void {
  console.log(`pm3m admin

Usage:
  pm3m admin create --email <address> [--force]
                          Create the first admin user and print a one-time
                          link (/auth/claim?token=...) to set a password.
                          Fails if an admin already exists unless --force
                          is passed.
`);
}

function printOauthPrivateKey(): void {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  console.log(`PROJECT_MEMORY_OAUTH_PRIVATE_KEY_PEM="${escapeEnvValue(pem)}"`);
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

function startPm2Direct(
  gatewayScript: string,
  processName: string,
  deployDir: string,
  runtimeEnv: NodeJS.ProcessEnv
): void {
  try {
    execFileSync("pm2", ["delete", processName], {
      stdio: "ignore",
      env: runtimeEnv
    });
  } catch {
    // Process did not exist.
  }

  execFileSync(
    "pm2",
    [
      "start",
      gatewayScript,
      "--name",
      processName,
      "--cwd",
      deployDir,
      "--update-env",
      "--watch",
      ".env",
      "--ignore-watch",
      "node_modules",
      "--ignore-watch",
      ".git",
      "--ignore-watch",
      ".agent",
      "--ignore-watch",
      "logs",
      "--ignore-watch",
      "artifacts",
      "--max-memory-restart",
      "256M",
      "--restart-delay",
      "2000",
      "--max-restarts",
      "10",
      "--exp-backoff-restart-delay",
      "200"
    ],
    {
      stdio: "inherit",
      env: runtimeEnv
    }
  );
  console.log(`pm3m gateway process started as ${processName}.`);
}

function parseEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

function escapeEnvValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/"/g, '\\"');
}

function printHelp(): void {
  console.log(`pm3m

Usage:
  pm3m start              Start or reload the PM2 gateway from the current .env directory
  pm3m migrate [latest]   Apply PostgreSQL migrations using .env from the current directory
  pm3m seed templates     Seed or update bundled common artifact templates
  pm3m oauth key          Print PROJECT_MEMORY_OAUTH_PRIVATE_KEY_PEM for .env
  pm3m admin create       Create the first admin user (bootstrap, one-time)
  pm3m status             Show PostgreSQL migration status
  pm3m rollback           Roll back the latest PostgreSQL migration batch
  pm3m gateway            Run the gateway directly without PM2
  pm3m stdio              Run the local SQLite stdio MCP server
  pm3m help               Show this help
`);
}

function printOauthHelp(): void {
  console.log(`pm3m oauth

Usage:
  pm3m oauth key          Print a new RSA private key formatted for PROJECT_MEMORY_OAUTH_PRIVATE_KEY_PEM
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
