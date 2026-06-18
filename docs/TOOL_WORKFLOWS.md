# Project Memory MCP — Tool Workflows

This document describes recommended tool chains for agents using Project Memory MCP.

The tools are intentionally small. Agents should combine them into predictable workflows instead of treating them as unrelated commands.

## Session Start

Use this when an agent starts work in a repository.

```text
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
memory.create, if new reusable context or a failed attempt should be preserved
decision.record, if an architectural/product/workflow decision was made
```

Purpose:

- make task lifecycle visible
- preserve important knowledge
- avoid repeating failed attempts

## Research And Planning

Use this before changing design or implementation strategy.

```text
project.current
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
memory.create(type="failed_attempt")
link.create(relation="warns_against")
event.record(type="attempt.failed")
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
decision.record(supersedesId="D-...")
decision.get
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
memory.create(type="failed_attempt")
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

## Default Agent Chain

For most implementation tasks, use:

```text
project.current
task.next
preflight
task.update_status(status="doing")
memory.search, if more context is needed
decision.get or memory.get, if ids from preflight need full detail
implement
npm run lint / typecheck / test / build, as appropriate
task.update_status(status="done")
memory.create / decision.record / event.record, if new durable knowledge exists
```

If anything blocks completion:

```text
task.update_status(status="blocked", note="...")
memory.create(type="failed_attempt"), if an approach should not be repeated
event.record(type="attempt.failed")
```
