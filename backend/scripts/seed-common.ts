import { bootstrap } from "../src/app/bootstrap.js";
import { loadConfig } from "../src/app/config.js";
import { commonRecords } from "./common-records.js";

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
