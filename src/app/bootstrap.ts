import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDecisionTools } from "../features/decisions/mcp/decision.tools.js";
import { DecisionRepo } from "../features/decisions/repo/decision.repo.js";
import { DecisionService } from "../features/decisions/service/decision.service.js";
import { registerEventTools } from "../features/events/mcp/event.tools.js";
import { EventRepo } from "../features/events/repo/event.repo.js";
import { EventService } from "../features/events/service/event.service.js";
import { registerLinkTools } from "../features/links/mcp/link.tools.js";
import { LinkRepo } from "../features/links/repo/link.repo.js";
import { LinkService } from "../features/links/service/link.service.js";
import { registerMemoryTools } from "../features/memory/mcp/memory.tools.js";
import { MemoryRepo } from "../features/memory/repo/memory.repo.js";
import { MemoryService } from "../features/memory/service/memory.service.js";
import { registerPreflightTool } from "../features/preflight/mcp/preflight.tools.js";
import { PreflightService } from "../features/preflight/service/preflight.service.js";
import { registerProjectTools } from "../features/projects/mcp/project.tools.js";
import { ProjectRepo } from "../features/projects/repo/project.repo.js";
import { ProjectService } from "../features/projects/service/project.service.js";
import { registerTaskTools } from "../features/tasks/mcp/task.tools.js";
import { TaskRepo } from "../features/tasks/repo/task.repo.js";
import { TaskService } from "../features/tasks/service/task.service.js";
import type { AppConfig } from "./config.js";
import { openDatabase, type Db } from "../shared/db/connection.js";
import { runMigrations } from "../shared/db/migrations.js";

export interface AppContext {
  db: Db;
  server: McpServer;
  projects: ProjectService;
  memory: MemoryService;
  events: EventService;
  tasks: TaskService;
  decisions: DecisionService;
  links: LinkService;
  preflight: PreflightService;
}

export function bootstrap(config: AppConfig): AppContext {
  const db = openDatabase(config.dbPath);
  runMigrations(db, config.migrationsDir);

  const projectRepo = new ProjectRepo(db);
  const projects = new ProjectService(projectRepo);
  const eventRepo = new EventRepo(db);
  const events = new EventService(db, eventRepo, projects);
  const memoryRepo = new MemoryRepo(db);
  const memory = new MemoryService(db, memoryRepo, projects);
  const taskRepo = new TaskRepo(db);
  const tasks = new TaskService(db, taskRepo, projects, events);
  const decisionRepo = new DecisionRepo(db);
  const decisions = new DecisionService(db, decisionRepo, projects, events);
  const linkRepo = new LinkRepo(db);
  const links = new LinkService(db, linkRepo, projects, events);
  const preflight = new PreflightService(projects, tasks, decisions, memory, events);

  const server = new McpServer({
    name: "project-memory-mcp",
    version: "0.1.0"
  });

  registerProjectTools(server, projects);
  registerMemoryTools(server, memory);
  registerEventTools(server, events);
  registerTaskTools(server, tasks);
  registerDecisionTools(server, decisions);
  registerLinkTools(server, links);
  registerPreflightTool(server, preflight);

  return {
    db,
    server,
    projects,
    memory,
    events,
    tasks,
    decisions,
    links,
    preflight
  };
}
