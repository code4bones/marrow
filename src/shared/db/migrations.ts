import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Db } from "./connection.js";
import { nowIso } from "../dates.js";

export function runMigrations(db: Db, migrationsDir: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const files = readdirSync(migrationsDir)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  const applied = db
    .prepare("SELECT id FROM migrations")
    .all()
    .map((row) => (row as { id: string }).id);
  const appliedSet = new Set(applied);

  for (const file of files) {
    const id = basename(file, ".sql").split("_", 1)[0];
    if (appliedSet.has(id)) {
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        id,
        file,
        nowIso()
      );
    });
    apply();
  }
}
