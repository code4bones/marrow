# Project Memory MCP — Tool Workflows

This document describes recommended tool chains for agents using Project Memory MCP.

The tools are intentionally small. Agents should combine them into predictable workflows instead of treating them as unrelated commands.

## Session Start

Use this when an agent starts work in a repository.

```text
project.resolve, when repository path/slug/remote is known
project.current
```

If current project is missing:

```text
project.list
project.create, if needed
project.set_current
project.current
```

Purpose:

- avoid writing records into the wrong project
- avoid guessing project context
- establish the scope used by tools with optional `project`

## Backlog Selection

Use this when an agent needs to choose work.

```text
project.current
task.next
task.get
preflight
```

Alternative:

```text
project.current
task.list
task.get
preflight
```

Purpose:

- select a concrete task
- load scope and acceptance criteria
- prevent implementation without preflight context

## Task Execution

Use this before and during implementation.

```text
project.current
task.get
preflight
task.update_status(status="doing")
```

Then work only inside the task scope.

After implementation:

```text
task.update_status(status="done")
event.record, if important history is not already captured
memory.upsert, if new reusable context should be preserved
failed_attempt.record, if a failed attempt should be preserved
decision.record, if an architectural/product/workflow decision was made
handoff.create, if another agent may continue the work
```

Purpose:

- make task lifecycle visible
- preserve important knowledge
- avoid repeating failed attempts

## Research And Planning

Use this before changing design or implementation strategy.

```text
project.current
preflight.by_query, when no task exists yet
memory.search
decision.list
event.list
link.list, if starting from a known record
```

For a specific record:

```text
memory.get
decision.get
task.get
link.list
```

Purpose:

- discover project and common constraints
- inspect prior decisions
- find related failed attempts or patterns

## Failed Attempt Recording

Use this when an approach fails in a way future agents should not repeat.

```text
failed_attempt.record
```

Recommended failed attempt body:

```text
What was tried:
Why it failed:
What should not be repeated:
Better next approach:
```

Purpose:

- make failure searchable
- attach it to a task, decision, or item
- include it in future preflight output

## Decision Recording

Use this when a decision should constrain future work.

```text
decision.record
link.create, if the decision constrains a task/item/older decision
event.list, if history is needed
```

For replaced decisions:

```text
decision.supersede
decision.get, if full replacement details are needed
```

Purpose:

- keep decisions first-class
- preserve rationale and consequences
- avoid hiding architecture in notes

## Linking Records

Use links when a relationship is durable and useful for navigation.

Common chains:

```text
task.get
decision.get
link.create(relation="depends_on")
```

```text
failed_attempt.record
task.get
link.create(relation="warns_against")
```

```text
memory.get
decision.get
link.create(relation="relates_to")
```

Useful relations:

- `depends_on`
- `relates_to`
- `supersedes`
- `implements`
- `warns_against`
- `belongs_to`
- `blocks`
- `references`

Purpose:

- preserve graph-like navigation without a graph database
- avoid duplicating record content

## Common Knowledge

Use common records only for reusable knowledge across projects.

```text
memory.create(project=null, common=true)
decision.record(project=null)
```

Good common records:

- agent workflow rules
- reusable implementation patterns
- definition of done templates
- cross-project conventions

Bad common records:

- project-specific facts
- one-off debugging notes
- temporary ideas for a single project

## Artifact Navigation

Use this when browsing shared files by hierarchy or tags:

```text
artifact.list
artifact.get
```

Use this when searching by meaning:

```text
artifact.search
artifact.get
```

After upload:

```text
artifact.update_metadata, if title/description/tags need cleanup
artifact.archive, if a shared file is superseded but should remain retrievable
```

Purpose:

- keep reusable files discoverable
- avoid overwriting shared artifacts accidentally
- preserve old files through archival instead of deletion

## Default Agent Chain

For most implementation tasks, use:

```text
project.resolve, if repository identity is available
project.current
task.next
preflight
task.update_status(status="doing")
memory.search, if more context is needed
decision.get or memory.get, if ids from preflight need full detail
implement
npm run lint / typecheck / test / build, as appropriate
task.update_status(status="done")
memory.upsert / decision.record / decision.supersede / event.record, if new durable knowledge exists
handoff.create, if another agent or later session may continue the work
```

If anything blocks completion:

```text
task.update_status(status="blocked", note="...")
failed_attempt.record, if an approach should not be repeated
```
