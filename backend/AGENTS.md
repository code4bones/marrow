# AGENTS.md

# Project Memory MCP — Agent Instructions

This repository implements a general-purpose MCP server for project-oriented agent memory.

It is not tied to any single product, game, codebase, or domain. The server provides a structured memory layer that coding agents can use across many projects.

The main goal is to help agents avoid context loss, repeated mistakes, scope creep, and poor navigation through project knowledge.

## Core idea

The memory is organized around projects.

A project can have:

* tasks
* decisions
* notes
* features
* entities
* links
* events
* failed attempts
* reusable context
* generated documentation snapshots

There is also a `common` layer for reusable knowledge shared across projects.

Examples of common knowledge:

* agent workflow rules
* reusable implementation patterns
* project-management templates
* coding conventions
* accessibility principles
* Godot patterns
* TypeScript patterns
* DevOps patterns
* common prompt templates

Project-specific knowledge overrides common knowledge when there is a conflict.

## Agent role

When working in this repository, the agent is an implementation assistant, not the product owner.

The agent must:

* keep changes small and reviewable
* follow existing architecture
* avoid inventing large new features unless explicitly requested
* update memory-related docs when behavior changes
* prefer explicit schemas over vague free-form storage
* prefer typed records over unstructured blobs when the information has workflow meaning
* preserve backward compatibility where possible
* record important decisions in documentation until the MCP server can store them itself

## Do not

Do not:

* turn this into a generic note-taking app
* add a web UI unless explicitly requested
* add embeddings/vector search in the MVP
* add authentication in the MVP
* add remote sync in the MVP
* add cloud dependencies
* hardcode knowledge for one project, such as a game, DevOps project, or app
* assume Markdown is obsolete
* remove human-readable documentation
* hide important behavior inside magical prompts

## Preferred stack

Use:

* Node.js
* TypeScript
* SQLite
* SQLite FTS5 for search
* MCP SDK
* simple migrations
* plain JSON for structured fields when useful

Avoid heavy frameworks unless the user asks for them.

The server should be local-first.

## Architecture style

Use feature-oriented architecture inspired by FSD principles.

This is not a frontend application, so do not copy FSD mechanically. Apply the core ideas:

* split code by business capability
* keep reusable infrastructure in `shared/`
* keep feature logic inside `features/<feature>/`
* expose explicit public APIs from each feature
* avoid circular dependencies
* avoid god objects and giant manager classes
* prefer small modules with clear responsibility
* keep MCP handlers, services, repositories, and validation separated

Recommended source layout:

```text
src/
  app/
  features/
    projects/
    memory/
    tasks/
    decisions/
    events/
    links/
    preflight/
  shared/
```

Dependency direction:

```text
app -> features -> shared
```

`shared` must not import from `features`.

## Architecture principles

### 1. Project-first memory

Every project-specific record must belong to a project.

Shared reusable records should be stored in the common layer.

A query should normally return:

1. matching records from the current project
2. matching records from common knowledge

Project records should be ranked above common records.

### 2. Common is not a trash bin

Common records must be reusable across projects.

Good common record examples:

* `C-AGENT-001: Always run preflight before task execution`
* `C-AGENT-002: Keep diffs small`
* `C-TASK-001: Definition of Done template`
* `C-GODOT-001: Prefer components over god objects`

Bad common record examples:

* project-specific lore
* temporary ideas for a single product
* one-off debugging notes
* random snippets without context

### 3. Decisions are first-class

A decision is not just a note.

A decision should capture:

* context
* decision
* rationale
* consequences
* status
* whether it supersedes another decision

Decision statuses:

* `active`
* `superseded`
* `rejected`
* `draft`

Project-specific decisions override common decisions.

### 4. Tasks are first-class

A task should contain enough information for an agent to execute safely.

A task should include:

* title
* status
* project
* milestone
* scope
* acceptance criteria
* allowed files
* forbidden files
* dependencies
* notes

Task statuses:

* `todo`
* `doing`
* `blocked`
* `done`
* `cancelled`

### 5. Events are append-only history

Events are used for project memory timeline.

Examples:

* task started
* task completed
* bug found
* failed attempt recorded
* decision created
* project created
* migration applied

Do not rewrite event history casually.

### 6. Failed attempts matter

Agents often repeat old mistakes if those mistakes are not stored.

Failed attempts should be searchable and included in preflight output when relevant.

A failed attempt record should include:

* what was tried
* why it failed
* what should not be repeated
* related project/task/entity

### 7. Preflight is the most important tool

Before starting a task, an agent should call a preflight tool.

The preflight output should include:

* task summary
* relevant project decisions
* relevant common rules
* related items
* known failed attempts
* allowed scope
* forbidden scope
* acceptance criteria

The purpose of preflight is to prevent scope creep and repeated mistakes.

## MVP constraints

The MVP should include:

* project management
* common knowledge
* typed items
* tasks
* decisions
* links
* events
* search
* preflight
* SQLite persistence
* FTS5 search
* basic CLI or seed script
* MCP tools

The MVP should not include until requested:

* UI
* remote server mode
* auth
* permissions
* embeddings
* vector search
* cloud sync
* complex graph visualization
* multi-user collaboration


## Expected MCP tools

Initial MCP tool set:

* `project.create`
* `project.list`
* `project.get`
* `project.set_current`
* `project.current`
* `memory.create`
* `memory.search`
* `memory.get`
* `memory.update`
* `task.create`
* `task.list`
* `task.get`
* `task.next`
* `task.update_status`
* `decision.record`
* `decision.list`
* `decision.get`
* `event.record`
* `event.list`
* `link.create`
* `link.list`
* `preflight`

Tool names may be adapted to SDK conventions, but the concepts must remain clear.

## Data model expectations

Start with a pragmatic SQLite schema.

Expected core tables:

* `projects`
* `items`
* `tasks`
* `decisions`
* `links`
* `events`
* `kv`
* `migrations`

Use `project_id = NULL` or equivalent for common records.

Use stable human-readable IDs where practical.

Examples:

* `P-MEMORY`
* `P-ECHO`
* `C-AGENT-001`
* `D-ECHO-001`
* `T-ECHO-001`
* `I-ECHO-LORE-001`

Internal UUIDs may be added later, but human-readable IDs are preferred for MVP usability.

## Search behavior

Search should support:

* current project only
* common only
* project + common
* type filtering
* status filtering
* tag filtering where practical

Default behavior:

```text
search current project + common
```

Ranking rule:

```text
project-specific records before common records
```

## Documentation rules

Keep docs updated when changing major behavior.

Important docs:

* `docs/CONCEPT.md`
* `docs/FEATURES.md`
* `docs/ARCHITECTURE.md`
* `docs/SCHEMA.md`
* `docs/MCP_TOOLS.md`
* future `docs/TASKS.md`

Do not replace documentation with database records entirely.

The database is operational memory.

Markdown is human-readable canon and onboarding.

## Coding style

Use TypeScript with strict types where possible.

Prefer:

* clear names
* small files
* explicit exports
* feature-local types
* plain SQL
* readable validation
* no hidden mutable global state except controlled config/current project
* reusable functions where reuse is real and useful
* explicit contracts between layers

Avoid:

* large files over 300-400 lines unless justified
* circular imports
* massive service classes
* magic strings without constants
* broad `any`
* unrelated refactors during feature work
* generic abstractions that obscure simple logic

## Validation

After changes, run the smallest relevant validation.

Preferred checks:

```bash
npm run typecheck
npm run lint
npm test
```

If scripts do not exist yet, add them when setting up the project.

If runtime validation is not possible, provide exact manual test steps.

## Agent workflow

For each implementation task:

1. Read `AGENTS.md`.
2. Read relevant docs in `docs/`.
3. Identify the smallest scope.
4. Do not rewrite unrelated files.
5. Implement the requested change.
6. Add or update tests where practical.
7. Run validation.
8. Summarize:

   * what changed
   * what files changed
   * how it was validated
   * any follow-up tasks

When the MCP memory server becomes functional, the agent must additionally:

1. call `preflight` before task execution
2. record important events after task execution
3. record failed attempts if something did not work
4. record decisions when architecture changes

## Product philosophy

This project exists to make agents more reliable.

The server should help an agent answer:

* What project am I working on?
* What is the current task?
* What decisions constrain this task?
* What common rules apply?
* What was already tried?
* What must I not change?
* What does “done” mean?
* What related knowledge should I read first?

If a feature does not support this goal, it probably does not belong in the MVP.
