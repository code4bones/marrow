const dotenv = require("dotenv");

dotenv.config({ path: ".env", quiet: true });

const runtimeEnv = {
  ...process.env,
  NODE_ENV: "production",
  BIND: process.env.BIND ?? "127.0.0.1",
  PORT: process.env.PORT ?? "8765"
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
      time: false,
      env: runtimeEnv,
      env_production: runtimeEnv,
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 10,
      exp_backoff_restart_delay: 200,
      log_date_format: "HH:mm:ss",
    }
  ]
};
