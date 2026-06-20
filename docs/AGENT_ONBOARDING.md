# Project Memory MCP — Agent Onboarding

This is the first-run workflow for an agent connected to a shared pmem gateway.

Use it when:

- the agent has just connected to pmem
- the user asks what pmem is
- the agent starts work in a repository with shared project memory
- the agent needs reusable templates or team context

## First Calls

Start with the gateway itself:

```text
gateway.about
gateway.status
gateway.version
```

Then load the operating docs when the user or task needs them:

```text
gateway.manuals(audience="all", includeContent=true)
```

Use `audience="agent"` when only the agent workflow is needed.

## Select Project Scope

Resolve the repository or project before writing memory:

```text
project.resolve
project.current
```

If no current project is set:

```text
project.list
project.set_current
```

Create a project only when the repository is clearly new to pmem:

```text
project.create
project.set_current
```

## Load Work Context

For an existing task:

```text
task.next
task.get
preflight
```

For ad-hoc work before a task exists:

```text
preflight.by_query
memory.search
decision.list
event.list
```

Treat `knownFaults` as stop-signals. Do not repeat a failed approach until the
user or project context gives a reason to try it differently.

## Find Shared Files

Search gateway artifacts before creating local project docs:

```text
artifact.search query="frontend AGENTS template" includeCommon=true
artifact.list common=true pathPrefix="templates"
artifact.get id=<artifact id> includeContent=true
```

The gateway is the source of truth for bundled templates. Client agents should
not assume package-local template files exist.

## Execute Work

After preflight is clear:

```text
task.update_status(status="doing")
```

Then implement inside the requested scope and run the smallest relevant
validation.

After meaningful work:

```text
task.update_status(status="done")
event.record
decision.record
failed_attempt.record
handoff.create
```

Use only the records that match what actually happened.

## Ask The User When

Ask for clarification when:

- project identity is ambiguous
- multiple artifact templates are plausible and no clear winner exists
- an artifact overwrite would replace shared team knowledge
- preflight reports conflicting decisions, forbidden scope, or relevant faults
- validation requires a decision outside the task scope

Do not ask during the normal path when pmem has enough context to proceed.
