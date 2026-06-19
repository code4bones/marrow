#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
const gatewayScript = path.resolve(packageRoot, "dist", "src", "gateway.js");
const deployDir = process.cwd();
const ecosystemPath = path.resolve(deployDir, ".project-memory-gateway.ecosystem.cjs");
const processName = process.env.PM2_NAME ?? "project-memory-gateway";

if (!existsSync(path.resolve(deployDir, ".env"))) {
  throw new Error(`.env not found in ${deployDir}. Run this command from the gateway deployment directory.`);
}

if (!existsSync(gatewayScript)) {
  throw new Error(`Gateway entrypoint not found: ${gatewayScript}`);
}

writeFileSync(
  ecosystemPath,
  `const fs = require("fs");
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
`
);

execFileSync("pm2", ["startOrReload", ecosystemPath, "--env", "production"], {
  stdio: "inherit"
});

console.log(`PM2 gateway process configured from ${ecosystemPath}.`);

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
