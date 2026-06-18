import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrap, type AppContext } from "../src/app/bootstrap.js";

let tempDir: string;
let app: AppContext;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "project-memory-mcp-"));
  app = bootstrap({
    dbPath: join(tempDir, "memory.sqlite"),
    migrationsDir: resolve("migrations"),
    logLevel: "silent"
  });
});

afterEach(() => {
  app.db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("bootstrap", () => {
  it("runs migrations", () => {
    const tables = app.db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toContain("projects");
    expect(tables).toContain("items");
    expect(tables).toContain("items_fts");
    expect(tables).toContain("tasks");
    expect(tables).toContain("decisions");
    expect(tables).toContain("events");
  });

  it("creates a project and searches project plus common memory", () => {
    const project = app.projects.create({
      slug: "project-memory-mcp",
      title: "Project Memory MCP"
    });
    app.projects.setCurrent({ id: project.id });

    const common = app.memory.create({
      common: true,
      type: "agent_rule",
      title: "Keep diffs small",
      body: "Agents should keep changes reviewable.",
      tags: ["common", "agent"]
    });
    const projectItem = app.memory.create({
      type: "architecture_note",
      title: "Use SQLite FTS5",
      body: "Project search uses SQLite FTS5 for deterministic local search.",
      tags: ["search"]
    });

    expect(common.id).toBe("C-AGENT-001");
    expect(projectItem.projectId).toBe(project.id);

    const results = app.memory.search({ query: "search diffs", includeCommon: true });

    expect(results.map((item) => item.id)).toEqual([projectItem.id, common.id]);
  });
});
