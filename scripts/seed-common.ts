import { bootstrap } from "../src/app/bootstrap.js";
import { loadConfig } from "../src/app/config.js";

const commonRecords = [
  {
    type: "agent_rule",
    title: "Always run preflight before task execution",
    body: "Before starting an implementation task, call preflight to load task scope, decisions, common rules, failed attempts, and acceptance criteria.",
    tags: ["common", "agent", "workflow"]
  },
  {
    type: "agent_rule",
    title: "Keep diffs small and reviewable",
    body: "Agents should prefer small, reviewable changes and avoid unrelated refactors unless explicitly requested.",
    tags: ["common", "agent", "workflow"]
  },
  {
    type: "agent_rule",
    title: "Do not expand scope without explicit request",
    body: "If a task has explicit scope, do not add extra features or rewrite unrelated files without a direct request.",
    tags: ["common", "agent", "scope"]
  },
  {
    type: "agent_rule",
    title: "Record failed attempts",
    body: "When an approach fails in a useful way, record what was tried, why it failed, and what should not be repeated.",
    tags: ["common", "agent", "failed_attempt"]
  },
  {
    type: "workflow_rule",
    title: "Every task needs acceptance criteria",
    body: "Executable tasks should state what done means so an agent can validate completion.",
    tags: ["common", "task", "definition-of-done"]
  },
  {
    type: "workflow_rule",
    title: "Allowed and forbidden files should be explicit",
    body: "When possible, tasks should identify files or areas that are allowed and forbidden for the implementation.",
    tags: ["common", "task", "scope"]
  },
  {
    type: "architecture_note",
    title: "Prefer feature-oriented architecture",
    body: "Split code by business capability. Keep reusable infrastructure in shared and feature logic inside features.",
    tags: ["common", "architecture"]
  },
  {
    type: "architecture_note",
    title: "Shared code must be genuinely reusable",
    body: "Do not turn shared into a dumping ground. Shared modules should be reusable infrastructure or small generic helpers.",
    tags: ["common", "architecture"]
  }
];

const app = bootstrap(loadConfig());

let project = app.projects.list().find((candidate) => candidate.slug === "project-memory-mcp");
if (!project) {
  project = app.projects.create({
    slug: "project-memory-mcp",
    title: "Project Memory MCP",
    description: "Local-first MCP server for project-oriented agent memory.",
    rootPath: process.cwd()
  });
}
app.projects.setCurrent({ id: project.id });

for (const record of commonRecords) {
  const existing = app.memory.search({
    query: record.title,
    includeCommon: true,
    limit: 5
  });
  if (existing.some((item) => item.scope === "common" && item.title === record.title)) {
    continue;
  }
  app.memory.create({
    common: true,
    ...record
  });
}

app.db.close();
console.log("Seeded project-memory-mcp project and common records.");
