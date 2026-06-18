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

  it("tracks task lifecycle events", () => {
    const project = app.projects.create({
      slug: "project-memory-mcp",
      title: "Project Memory MCP"
    });
    app.projects.setCurrent({ id: project.id });

    const task = app.tasks.create({
      title: "Implement task lifecycle",
      priority: 10,
      acceptance: "Task can move to done.",
      allowedFiles: ["src/features/tasks/**"]
    });
    const updated = app.tasks.updateStatus({
      id: task.id,
      status: "done",
      note: "Validated with tests."
    });
    const events = app.events.list({ project: project.id, relatedId: task.id });

    expect(updated.status).toBe("done");
    expect(events.map((event) => event.type)).toEqual(["task.completed", "task.created"]);
  });

  it("records decisions and returns useful preflight context", () => {
    const project = app.projects.create({
      slug: "project-memory-mcp",
      title: "Project Memory MCP"
    });
    app.projects.setCurrent({ id: project.id });

    app.memory.create({
      common: true,
      type: "agent_rule",
      title: "Keep diffs small",
      body: "Before implementation, keep task diffs small and reviewable.",
      tags: ["common", "agent"]
    });
    app.memory.create({
      common: true,
      type: "workflow_rule",
      title: "Every task needs acceptance criteria",
      body: "Task acceptance criteria define when implementation is done.",
      tags: ["common", "task"]
    });
    app.memory.create({
      type: "failed_attempt",
      title: "FTS trigger mismatch",
      body: "FTS search failed when trigger columns did not match the items table.",
      tags: ["search"]
    });
    const decision = app.decisions.record({
      title: "Use SQLite FTS5",
      decision: "Use SQLite FTS5 for MVP search.",
      rationale: "It is local and inspectable.",
      tags: ["search", "mvp"]
    });
    const task = app.tasks.create({
      title: "Implement FTS search",
      scope: "Wire FTS search for project memory items.",
      acceptance: "Search returns project records before common records.",
      allowedFiles: ["src/features/memory/**"],
      forbiddenFiles: ["src/features/projects/**"]
    });

    const result = app.preflight.run({ taskId: task.id });

    expect(decision.id).toBe("D-MEMORY-001");
    expect(result.project.id).toBe(project.id);
    expect(result.task.allowedFiles).toEqual(["src/features/memory/**"]);
    expect(result.relevantDecisions.map((item) => item.id)).toContain(decision.id);
    expect(result.commonRules.length).toBeGreaterThan(0);
    expect(result.failedAttempts.map((item) => item.title)).toContain("FTS trigger mismatch");
    expect(result.recentEvents.map((event) => event.type)).toContain("task.created");
  });

  it("creates and lists links between records", () => {
    const project = app.projects.create({
      slug: "project-memory-mcp",
      title: "Project Memory MCP"
    });
    app.projects.setCurrent({ id: project.id });

    const task = app.tasks.create({
      title: "Implement link tools"
    });
    const decision = app.decisions.record({
      title: "Links are lightweight",
      decision: "Use a simple links table instead of graph database behavior."
    });

    const link = app.links.create({
      fromId: task.id,
      toId: decision.id,
      relation: "depends_on"
    });
    const links = app.links.list({ id: task.id });

    expect(link.id).toBe("L-MEMORY-001");
    expect(links).toHaveLength(1);
    expect(links[0]?.toId).toBe(decision.id);
  });
});
