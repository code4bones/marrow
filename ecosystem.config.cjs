const dotenv = require("dotenv");

dotenv.config({ path: ".env", quiet: true });

const bind = process.env.PROJECT_MEMORY_GATEWAY_HOST ?? process.env.BIND ?? "127.0.0.1";
const port = process.env.PROJECT_MEMORY_GATEWAY_PORT ?? process.env.PORT ?? "8765";
const runtimeEnv = {
  ...process.env,
  NODE_ENV: "production",
  PROJECT_MEMORY_GATEWAY_HOST: bind,
  PROJECT_MEMORY_GATEWAY_PORT: port
};

module.exports = {
  apps: [
    {
      name: "project-memory-gateway",
      cwd: __dirname,
      script: "scripts/pm2-gateway.cjs",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      watch: ["dist/src", "migrations/pg", "knexfile.cjs", ".env"],
      ignore_watch: ["node_modules", ".git", ".agent", "logs"],
      watch_delay: 1000,
      max_memory_restart: "256M",
      time: true,
      env: runtimeEnv,
      env_production: runtimeEnv
    }
  ]
};
