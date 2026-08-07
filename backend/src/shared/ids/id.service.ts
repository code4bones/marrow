import type { Db } from "../db/connection.js";

const PROJECT_STOP_WORDS = new Set(["project", "mcp", "server"]);

export function createProjectId(slug: string): string {
  const parts = slug
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .filter((part) => !PROJECT_STOP_WORDS.has(part.toLowerCase()));
  const key = parts[0] ?? slug.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return `P-${key || "PROJECT"}`;
}

export function projectKeyFromId(projectId: string): string {
  return projectId.replace(/^P-/, "").replace(/[^A-Z0-9]/gi, "").toUpperCase() || "PROJECT";
}

export function commonItemPrefix(type: string): string {
  const normalized = type.replace(/_rule$/, "").replace(/_template$/, "").split("_", 1)[0];
  return `C-${normalized.toUpperCase() || "ITEM"}`;
}

export function nextId(db: Db, table: string, prefix: string): string {
  const rows = db.prepare(`SELECT id FROM ${table} WHERE id LIKE ?`).all(`${prefix}-%`) as {
    id: string;
  }[];
  const next = rows.reduce((max, row) => {
    const match = row.id.match(/-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0) + 1;

  return `${prefix}-${String(next).padStart(3, "0")}`;
}
