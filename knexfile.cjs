require("dotenv").config({ quiet: true });

const sslValue = process.env.POSTGRES_SSL ?? process.env.PGSSLMODE;
const useSsl = sslValue === "true" || sslValue === "require";

const connection =
  process.env.PROJECT_MEMORY_DATABASE_URL ??
  process.env.DATABASE_URL ??
  {
    host: process.env.POSTGRES_HOST ?? "127.0.0.1",
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? "project_memory",
    user: process.env.POSTGRES_USER ?? "project_memory",
    password: process.env.POSTGRES_PASSWORD ?? undefined,
    ssl: useSsl ? { rejectUnauthorized: false } : false
  };

module.exports = {
  client: "pg",
  connection,
  pool: {
    min: 0,
    max: Number(process.env.PROJECT_MEMORY_PG_POOL_MAX ?? 10)
  },
  migrations: {
    directory: "migrations/pg",
    tableName: "knex_migrations"
  }
};
