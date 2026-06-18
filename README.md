# Project Memory MCP

Local-first MCP server for structured project memory used by coding agents.

The server stores projects, common knowledge, memory items, tasks, decisions, links, events, and preflight context in SQLite. Search uses SQLite FTS5.

## Current Status

Implemented core MVP tools:

- `project.create`
- `project.list`
- `project.get`
- `project.set_current`
- `project.current`
- `memory.create`
- `memory.get`
- `memory.search`
- `memory.update`
- `task.create`
- `task.list`
- `task.get`
- `task.next`
- `task.update_status`
- `decision.record`
- `decision.list`
- `decision.get`
- `event.record`
- `event.list`
- `link.create`
- `link.list`
- `preflight`

See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for the detailed implementation status, validation notes, and known follow-up work.

See [docs/TOOL_WORKFLOWS.md](docs/TOOL_WORKFLOWS.md) for recommended tool chains agents should follow.

See [docs/AGENT_STATE_MACHINE.md](docs/AGENT_STATE_MACHINE.md) for the agent state machine and clarification triggers.

## Setup

```bash
npm install
npm run build
```

Default database path:

```text
.agent/project-memory.sqlite
```

Override it with:

```bash
PROJECT_MEMORY_DB=/path/to/project-memory.sqlite
```

## Seed Common Memory

```bash
npm run seed:common
```

This creates the `project-memory-mcp` project if missing, sets it as current, and seeds common rules such as:

- `C-AGENT-001`
- `C-AGENT-002`
- `C-AGENT-003`
- `C-AGENT-004`
- `C-TASK-001`
- `C-TASK-002`
- `C-ARCH-001`
- `C-ARCH-002`

## Run MCP Server

Development:

```bash
npm run dev
```

Built server:

```bash
npm run build
node dist/src/index.js
```

MCP clients should run the server over stdio.

Example command:

```bash
node /absolute/path/to/project-memory-mcp/dist/src/index.js
```

## Distribution Contents

The npm package includes the built server, built helper scripts, migrations, and project documentation:

- `dist/src`
- `dist/scripts`
- `migrations`
- `docs`
- `README.md`
- `AGENTS.md`

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke
npm run smoke:stdio
```

## Notes

- The server is local-first.
- There is no UI, auth, remote sync, cloud dependency, embeddings, or vector search in the MVP.
- Project-specific memory and common memory are separate. Default search includes current project plus common knowledge.
- `preflight` is the main workflow guardrail before editing project files.
