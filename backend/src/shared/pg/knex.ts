import knex, { type Knex } from "knex";
import dotenv from "dotenv";
import { types as pgTypes } from "pg";

dotenv.config({ quiet: true });

// node-postgres's default DATE (OID 1082) parser returns a JS Date built at
// LOCAL midnight, not UTC -- round-tripping that through .toISOString()
// (UTC-based) silently shifts the calendar day backward for any server
// timezone east of UTC (D-MEMORY-037's streaks.last_credited_date hit this
// exactly: a value written as "2026-08-17" came back as
// "2026-08-16T21:00:00.000Z" on a UTC+3 host). Registering the raw-string
// parser once here, globally, sidesteps the whole Date/timezone
// round-trip -- every DATE column across the app gets back exactly the
// "YYYY-MM-DD" string it was given, no matter what timezone the process
// runs in.
pgTypes.setTypeParser(1082, (value) => value);

export function createPgKnex(): Knex {
  const sslValue = process.env.POSTGRES_SSL;
  const useSsl = sslValue === "true" || sslValue === "require";

  return knex({
    client: "pg",
    connection: {
      host: process.env.POSTGRES_HOST ?? "127.0.0.1",
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      database: process.env.POSTGRES_DB ?? "project_memory",
      user: process.env.POSTGRES_USER ?? "project_memory",
      password: process.env.POSTGRES_PASSWORD ?? undefined,
      ssl: useSsl ? { rejectUnauthorized: false } : false
    },
    pool: {
      min: 0,
      max: Number(process.env.POSTGRES_POOL_MAX ?? 10)
    }
  });
}
