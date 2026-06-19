#!/usr/bin/env node
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPgKnex } from "../src/shared/pg/knex.js";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), quiet: true });

const command = process.argv[2] ?? "latest";
const packageRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));
const migrationsDir = path.resolve(packageRoot, "migrations", "pg");
const db = createPgKnex();

try {
  switch (command) {
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
      throw new Error(`Unknown command "${command}". Use latest, status, or rollback.`);
  }
} finally {
  await db.destroy();
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
