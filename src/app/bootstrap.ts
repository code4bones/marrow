import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMemoryTools } from "../features/memory/mcp/memory.tools.js";
import { MemoryRepo } from "../features/memory/repo/memory.repo.js";
import { MemoryService } from "../features/memory/service/memory.service.js";
import { registerProjectTools } from "../features/projects/mcp/project.tools.js";
import { ProjectRepo } from "../features/projects/repo/project.repo.js";
import { ProjectService } from "../features/projects/service/project.service.js";
import type { AppConfig } from "./config.js";
import { openDatabase, type Db } from "../shared/db/connection.js";
import { runMigrations } from "../shared/db/migrations.js";

export interface AppContext {
  db: Db;
  server: McpServer;
  projects: ProjectService;
  memory: MemoryService;
}

export function bootstrap(config: AppConfig): AppContext {
  const db = openDatabase(config.dbPath);
  runMigrations(db, config.migrationsDir);

  const projectRepo = new ProjectRepo(db);
  const projects = new ProjectService(projectRepo);
  const memoryRepo = new MemoryRepo(db);
  const memory = new MemoryService(db, memoryRepo, projects);

  const server = new McpServer({
    name: "project-memory-mcp",
    version: "0.1.0"
  });

  registerProjectTools(server, projects);
  registerMemoryTools(server, memory);

  return {
    db,
    server,
    projects,
    memory
  };
}
