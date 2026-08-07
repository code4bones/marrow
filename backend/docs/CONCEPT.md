# CONCEPT.md

# Project Memory MCP — Concept

## What this is

Project Memory MCP is a local-first MCP server that gives coding agents a structured memory layer across multiple projects.

It is designed for agents such as Codex or similar coding assistants that need to work on long-lived projects without repeatedly losing context.

The server stores project knowledge in a SQLite database and exposes it through MCP tools.

The memory is organized around:

* projects
* common reusable knowledge
* tasks
* decisions
* typed items
* links
* events
* failed attempts

The goal is not to create another notes app.

The goal is to create an operational memory system that agents can use before, during, and after implementation tasks.

## Problem

Coding agents often fail in predictable ways:

* they forget earlier decisions
* they repeat failed approaches
* they expand scope too aggressively
* they cannot distinguish current project rules from general reusable rules
* they scan too much irrelevant context
* they lose track of task status
* they do not know which files are allowed to change
* they do not preserve reasoning in a durable project-level form

Markdown files help, but they are not enough for all workflows.

Markdown is good for human-readable canon.

A database is better for:

* task queues
* search
* statuses
* links
* project separation
* preflight summaries
* event history
* failed attempts
* typed records

Project Memory MCP combines both.

## Core model

The memory database has two layers:

```text
common
projects
```

### Common layer

The common layer stores reusable knowledge that can apply to many projects.

Examples:

* agent rules
* coding patterns
* task templates
* Definition of Done templates
* reusable architecture notes
* common DevOps snippets
* common Godot patterns
* common accessibility rules

Common records are not tied to a specific project.

### Project layer

Each project has its own scoped memory.

Examples:

* project-specific tasks
* project-specific decisions
* project-specific lore or product facts
* project-specific architecture notes
* project-specific failed attempts
* project-specific entities
* project-specific events

When an agent works on a project, search should usually include both:

```text
current project + common
```

Project records should rank above common records.

Project decisions override common decisions when they conflict.

## Why MCP

MCP is the integration layer between the agent and the memory system.

Instead of asking an agent to grep files manually every time, the agent can call explicit tools:

* search memory
* get current project
* get next task
* run task preflight
* record a decision
* record a failed attempt
* update task status
* record an event

This makes the memory usable as part of the agent workflow.

## Key concept: preflight

The most important workflow is task preflight.

Before starting a task, an agent should request a preflight summary.

A good preflight answer should include:

* project summary
* task summary
* relevant decisions
* relevant common rules
* related records
* known failed attempts
* dependencies
* allowed files
* forbidden files
* acceptance criteria

The purpose is to keep the agent grounded before it edits code.

Example:

```text
Task: Implement AcousticZone

Relevant project decisions:
- D-ECHO-001: Use Godot 4.x
- D-ECHO-004: Audio clarity beats realism
- D-ECHO-006: No full ship in MVP

Relevant common rules:
- C-AGENT-001: Keep diffs small
- C-AGENT-002: Do not expand scope
- C-TASK-001: Validate after each change

Known failed attempts:
- A-ECHO-003: Global ambience player made room transitions unclear

Allowed files:
- components/AcousticZone.gd
- autoload/AudioManager.gd
- scenes/test/TestAcousticZones.tscn
```

This turns memory into a guardrail, not just a database.

## What this is not

This is not:

* a hosted service
* a web dashboard
* a replacement for Git
* a replacement for Markdown docs
* a replacement for issue trackers in large teams
* a vector database experiment
* a generic personal knowledge base
* a chat history archive only

It may later integrate with other systems, but the MVP should remain local, simple, inspectable, and reliable.

## MVP philosophy

The MVP should be small and useful.

The first version should prove that an agent can:

1. create or select a project
2. store common records
3. store project records
4. search project + common knowledge
5. create and update tasks
6. record decisions
7. record events
8. run preflight for a task
9. avoid repeated mistakes through failed-attempt records

No UI is required.

No embeddings are required.

No cloud sync is required.

## Why not embeddings first

Embeddings may be useful later, but they are not required for the first useful version.

SQLite FTS5 is enough for the MVP because:

* project memory is relatively small
* exact terms and tags matter
* typed records matter more than semantic vibes
* FTS is deterministic and inspectable
* it avoids API dependencies
* it keeps the project local-first

Embeddings can be added later as an optional index.

## Suggested storage

Use SQLite.

Benefits:

* local-first
* easy to back up
* easy to inspect
* supports FTS5
* no server required
* works well for single-user agent workflows

Expected local path:

```text
.agent/memory.sqlite
```

or configurable through environment variable:

```text
PROJECT_MEMORY_DB=/path/to/memory.sqlite
```

## Suggested repository shape

```text
project-memory-mcp/
  AGENTS.md
  package.json
  tsconfig.json
  docs/
    CONCEPT.md
    FEATURES.md
    ARCHITECTURE.md
    SCHEMA.md
    MCP_TOOLS.md
  src/
    index.ts
    db/
      connection.ts
      migrations.ts
      schema.sql
    tools/
      project.ts
      memory.ts
      task.ts
      decision.ts
      event.ts
      preflight.ts
    services/
      search.ts
      preflight.ts
      ids.ts
      validation.ts
    types/
      index.ts
  migrations/
    001_init.sql
  scripts/
    seed-common.ts
    seed-demo-project.ts
```

## Record types

The system should support typed records.

Initial `items.type` examples:

* `agent_rule`
* `workflow_rule`
* `snippet`
* `pattern`
* `note`
* `feature`
* `mechanic`
* `entity`
* `lore_fact`
* `audio_cue`
* `accessibility_rule`
* `failed_attempt`
* `research_note`
* `glossary_term`
* `prompt_template`

The system must not be limited to game development.

Game-related types are allowed because this MCP may be used for games, but they must not be hardcoded as the only supported domain.

## Projects

A project represents a durable work context.

Examples:

```text
agent-flow-book
wb-automation
frappe-deploy
echo-dawn
project-memory-mcp
```

A project should include:

* id
* slug
* title
* description
* status
* root path
* timestamps

The `slug` should be human-friendly and stable.

## Common knowledge

Common knowledge can be represented as records with no project, or with a reserved common scope.

For MVP, prefer:

```text
project_id = NULL
```

This keeps queries simple:

```sql
WHERE project_id = :current_project_id OR project_id IS NULL
```

## IDs

Prefer readable IDs for records that agents and humans will reference.

Examples:

```text
P-MEMORY
P-ECHO
C-AGENT-001
C-TASK-001
D-MEMORY-001
T-MEMORY-001
I-MEMORY-001
```

Do not overcomplicate ID generation in the MVP.

A simple prefix + sequence per project/type is acceptable.

## Search

Search should support:

* query text
* project slug
* include common
* type filter
* status filter
* limit

Default behavior:

```text
project + common
```

Example:

```text
memory.search query="preflight task rules" project="project-memory-mcp" include_common=true
```

## Links

Links allow the memory to become a lightweight graph.

Examples:

```text
task depends_on decision
decision supersedes decision
item relates_to feature
failed_attempt warns_against task
entity implemented_by file
```

MVP links can be simple:

* from id
* to id
* relation
* optional project id

## Events

Events are append-only timeline records.

They help answer:

* what happened?
* when did this decision appear?
* what did the agent try?
* what changed after the last task?

Event examples:

* project created
* task created
* task started
* task completed
* decision recorded
* failed attempt recorded
* migration applied

## Generated docs

The database should not eliminate Markdown.

Future feature: export memory snapshots into Markdown.

Examples:

```text
docs/generated/PROJECTS.md
docs/generated/TASKS.md
docs/generated/DECISIONS.md
docs/generated/COMMON_RULES.md
```

This keeps the memory inspectable by humans and by agents that only have filesystem access.

## Success criteria

The project is successful when an agent can:

* discover the current project
* fetch the next task
* get preflight context
* understand relevant decisions
* avoid known failed attempts
* complete a small implementation task
* update task status
* record an event
* leave the project memory better than it found it

The server should make agents less chaotic.
