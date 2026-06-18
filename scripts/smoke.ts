import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bootstrap } from "../src/app/bootstrap.js";

interface SmokeStep {
  name: string;
  run: () => void;
}

const tempDir = mkdtempSync(join(tmpdir(), "project-memory-mcp-smoke-"));
const dbPath = join(tempDir, "memory.sqlite");
const app = bootstrap({
  dbPath,
  migrationsDir: resolve("migrations"),
  logLevel: "silent"
});

const state: {
  projectId?: string;
  taskId?: string;
  decisionId?: string;
  failedAttemptId?: string;
  linkId?: string;
} = {};

const steps: SmokeStep[] = [
  {
    name: "create project and set current",
    run: () => {
      const project = app.projects.create({
        slug: "project-memory-mcp-smoke",
        title: "Project Memory MCP Smoke",
        rootPath: process.cwd()
      });
      app.projects.setCurrent({ id: project.id });

      assert(project.id === "P-MEMORY", `Expected project id P-MEMORY, got ${project.id}.`);
      assert(app.projects.current().id === project.id, "Current project was not set.");
      state.projectId = project.id;
    }
  },
  {
    name: "create common rules and project memory",
    run: () => {
      const commonRule = app.memory.create({
        id: "C-AGENT-001",
        common: true,
        type: "agent_rule",
        title: "Always run preflight before task execution",
        body: "Before starting implementation, run preflight.",
        tags: ["common", "agent"]
      });
      const failedAttempt = app.memory.create({
        type: "failed_attempt",
        title: "FTS trigger mismatch",
        body: "FTS search failed when trigger columns did not match the items table.",
        tags: ["search"]
      });

      assert(commonRule.projectId === null, "Common rule should not belong to a project.");
      assert(failedAttempt.projectId === state.projectId, "Failed attempt should belong to project.");
      state.failedAttemptId = failedAttempt.id;
    }
  },
  {
    name: "create task and decision",
    run: () => {
      const task = app.tasks.create({
        title: "Implement FTS search",
        scope: "Wire FTS search for project memory items.",
        acceptance: "Search returns project records before common records.",
        allowedFiles: ["src/features/memory/**"],
        forbiddenFiles: ["src/features/projects/**"],
        priority: 10
      });
      const decision = app.decisions.record({
        title: "Use SQLite FTS5",
        decision: "Use SQLite FTS5 for MVP memory search.",
        rationale: "It is local, inspectable, and deterministic.",
        tags: ["search", "mvp"]
      });

      assert(task.id === "T-MEMORY-001", `Expected first task id T-MEMORY-001, got ${task.id}.`);
      assert(decision.id === "D-MEMORY-001", `Expected first decision id D-MEMORY-001, got ${decision.id}.`);
      state.taskId = task.id;
      state.decisionId = decision.id;
    }
  },
  {
    name: "create link and update task",
    run: () => {
      assert(state.taskId, "Missing task id.");
      assert(state.decisionId, "Missing decision id.");

      const link = app.links.create({
        fromId: state.taskId,
        toId: state.decisionId,
        relation: "depends_on"
      });
      const task = app.tasks.updateStatus({
        id: state.taskId,
        status: "doing",
        note: "Smoke test started the task."
      });

      assert(link.id === "L-MEMORY-001", `Expected first link id L-MEMORY-001, got ${link.id}.`);
      assert(task.status === "doing", "Task status was not updated.");
      state.linkId = link.id;
    }
  },
  {
    name: "search and preflight",
    run: () => {
      assert(state.taskId, "Missing task id.");

      const searchResults = app.memory.search({
        query: "FTS search",
        includeCommon: true,
        limit: 10
      });
      const preflight = app.preflight.run({
        taskId: state.taskId
      });

      assert(searchResults.some((item) => item.id === state.failedAttemptId), "Failed attempt was not searchable.");
      assert(preflight.project.id === state.projectId, "Preflight returned the wrong project.");
      assert(preflight.task.id === state.taskId, "Preflight returned the wrong task.");
      assert(
        preflight.relevantDecisions.some((decision) => decision.id === state.decisionId),
        "Preflight did not include the recorded decision."
      );
      assert(
        preflight.failedAttempts.some((item) => item.id === state.failedAttemptId),
        "Preflight did not include the failed attempt."
      );
    }
  },
  {
    name: "verify events and links",
    run: () => {
      assert(state.taskId, "Missing task id.");
      assert(state.linkId, "Missing link id.");

      const taskEvents = app.events.list({
        relatedId: state.taskId,
        limit: 10
      });
      const links = app.links.list({
        id: state.taskId,
        direction: "both"
      });

      assert(taskEvents.some((event) => event.type === "task.created"), "Missing task.created event.");
      assert(taskEvents.some((event) => event.type === "task.started"), "Missing task.started event.");
      assert(links.some((link) => link.id === state.linkId), "Created link was not listed.");
    }
  }
];

try {
  for (const step of steps) {
    step.run();
    console.log(`ok - ${step.name}`);
  }
  console.log(`Smoke test passed using ${dbPath}`);
} finally {
  app.db.close();
  rmSync(tempDir, { recursive: true, force: true });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
