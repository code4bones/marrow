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

Use `audience="conventions"` when the task involves ChatGPT-Codex
collaboration, handoffs, artifacts, or deciding which pmem storage surface to
use.

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
project.summary
context.pack(taskId=<task id>, mode="brief")
preflight
```

For ad-hoc work before a task exists:

```text
project.summary
context.pack(query=<work topic>, mode="brief")
context.changed_since, only if resuming from a stored cursor
preflight.by_query
memory.search
decision.list
event.list
```

For collaboration-heavy work, also load:

```text
gateway.manuals(audience="conventions", includeContent=true)
project.summary
handoff.latest, or handoff.search for a specific topic
artifact.search, if the task mentions shared docs, instructions, or generated files
artifact.read_text, if a matching Markdown/text artifact must be read into context
```

Treat `knownFaults` as stop-signals. Do not repeat a failed approach until the
user or project context gives a reason to try it differently.

## Find Shared Files

Search gateway artifacts before creating local project docs:

```text
artifact.search query="frontend AGENTS template" includeCommon=true
artifact.list common=true pathPrefix="templates"
artifact.peek id=<artifact id>
artifact.read_text id=<artifact id>, when Markdown/text content is needed
artifact.put_text path=<artifact path> text=<updated text>, when Markdown/text content should be saved
artifact.get id=<artifact id> includeContent=true, only if exact base64 bytes are needed
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

Write back durable information only. Use `handoff.create` for compact session
summaries, `memory.upsert` for compact reusable status or conventions,
`decision.record` for durable architecture, `artifact.put_text` for generated text files,
`artifact.put` for binaries or exact bytes
or docs, and `failed_attempt.record` for dead ends. Do not write pmem after
every tiny edit.

## Ask The User When

Ask for clarification when:

- project identity is ambiguous
- multiple artifact templates are plausible and no clear winner exists
- an artifact overwrite would replace shared team knowledge
- preflight reports conflicting decisions, forbidden scope, or relevant faults
- validation requires a decision outside the task scope

Do not ask during the normal path when pmem has enough context to proceed.
