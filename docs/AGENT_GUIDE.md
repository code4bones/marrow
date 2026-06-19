# Project Memory MCP — Agent Guide

This guide tells agents when and how to use Project Memory MCP (`pmem`).

Use it as an operating procedure. Do not treat pmem as a passive note database.
It is part of task execution.

## First Rule

If the user asks what `pmem`, `project-memory`, or this MCP server is, call:

```text
gateway.about
```

Then summarize the result in human language.

If the user asks for manuals, docs, instructions, onboarding, or Markdown files
explaining pmem, call:

```text
gateway.manuals
```

Use `includeContent=true` when the user wants the actual `.md` text.

## Confirm Shared Gateway Mode

When collaboration or shared knowledge matters, call:

```text
gateway.status
```

Use shared gateway mode when status says:

```text
mode: gateway
storage: postgresql
```

If you only have local SQLite state, say that shared collaboration memory is not
confirmed.

## When To Use pmem

Use pmem before work when:

- starting work in a repository
- the user asks to continue project work
- the task is non-trivial or affects architecture
- the task references previous decisions, mistakes, tasks, or docs
- you need a reusable template or shared artifact
- multiple developers or agents may touch the same project
- you are about to create, supersede, or rely on a decision
- an approach failed in a way future agents should not repeat

Use pmem after work when:

- a task status changed
- a durable decision was made
- a failed attempt should be preserved
- a reusable file should be shared as an artifact
- important project history should appear in the timeline

## When Not To Use pmem

Do not use pmem for:

- trivial one-command answers
- secrets, tokens, credentials, private keys, or passwords
- raw build logs unless summarized
- temporary scratch notes
- every small observation during implementation
- project-specific facts stored as common knowledge

## Default Implementation Flow

For normal coding work:

```text
project.resolve, when repository identity is available
project.current
task.next or task.get
preflight
task.update_status(status="doing")
implement
validate
task.update_status(status="done")
event.record, if useful
memory.create / decision.record, only for durable knowledge
```

If no task exists but the user gave a concrete request:

```text
project.resolve, when repository identity is available
project.current
preflight.by_query
implement
validate
record durable memory if needed
```

If no current project exists:

```text
project.list
project.create, if repository identity is clear
project.set_current
project.current
```

Ask the user only if multiple plausible projects exist or the project identity
is unclear.

## Preflight Discipline

Run `preflight` before editing when a task exists.

Use preflight output to check:

- task summary
- acceptance criteria
- allowed files
- forbidden files
- relevant project decisions
- relevant common rules
- known failed attempts and `knownFaults`
- related links

Stop and ask the user when preflight reveals:

- conflicting decisions
- forbidden scope
- missing acceptance criteria
- matching failed attempts or `knownFaults`
- blocked dependencies
- materially different implementation strategies with product or architecture
  consequences

## Search Discipline

Before answering from memory, search:

```text
memory.search
decision.list
event.list, when history matters
link.list, when starting from a known record
```

Default search should include current project plus common knowledge.

Rank project-specific results above common results when both apply.

## Artifact Discipline

Artifacts are shared files on the gateway.

Use artifacts when the user asks for reusable files, templates, shared docs, or
downloadable assets.

Search before creating:

```text
artifact.search
artifact.list, when browsing by path or tags
```

Use common artifacts for reusable cross-project files:

```json
{
  "common": true,
  "path": "templates/frontend/AGENTS.md"
}
```

Use project artifacts for files specific to one project:

```json
{
  "project": "project-memory-mcp",
  "path": "docs/snapshots/architecture-2026-06-19.md"
}
```

For small text or Markdown files, `artifact.get` may include content.

For binary files or larger files, use the returned `downloadPath` and append it
to `GW_ENDPOINT`.

Ask before overwriting an artifact unless the user explicitly requested a
replacement.

Ask when multiple artifacts are plausible matches.

Use `artifact.update_metadata` when the bytes are correct but title,
description, or tags need cleanup.

Use `artifact.archive` instead of deleting shared files. Archived artifacts are
hidden from default search but remain retrievable by explicit id/path or
`includeArchived=true`.

## Recording Rules

Use `decision.record` for:

- architecture decisions
- workflow decisions
- product decisions
- rejected options with rationale
- decisions that supersede older decisions

Use `decision.supersede` when replacing an existing decision. Prefer it over
manually recording a new decision and separately updating the old status.

Use `memory.create` for:

- reusable implementation notes
- patterns
- entities
- snippets that are likely to be reused

Use `memory.upsert` when the durable note may already exist.

Use `failed_attempt.record` when an approach failed and future agents should not
repeat it. Treat this as the current fault-recording tool: include what was
tried, why it failed, what not to repeat, and the better next approach.

Record a fault when:

- a command/tool/deploy/migration path fails for a reusable reason
- a library, CLI, or gateway behavior is surprising enough to trap another agent
- a retry would waste time unless the next approach is changed
- the failure explains why a tempting implementation path should be avoided

Do not record a fault for a typo that was fixed immediately and has no future
value.

Use `handoff.create` when another agent or future session needs a compact
continuation point.

Use `event.record` for:

- append-only history
- important milestones
- migrations
- task lifecycle events not already captured elsewhere

`failed_attempt.record` already records the failed-attempt event; use
`event.record` separately only for additional history that is not captured by a
first-class tool.

Use `link.create` when records have a durable relationship:

- `depends_on`
- `warns_against`
- `relates_to`
- `supersedes`
- `blocks`
- `references`

## Clarification Triggers

Ask the user before proceeding when:

- no current project exists and selection is ambiguous
- no task exists and the user did not provide a concrete task
- preflight conflicts with the request
- acceptance criteria are missing or contradictory
- requested edits exceed allowed scope
- forbidden files are required
- a failed attempt or `knownFaults` record matches the planned approach
- an artifact overwrite would replace shared knowledge
- several artifact templates could fit and there is no clear winner
- using common knowledge would leak project-specific or private information

Do not ask when you can safely:

- select the existing current project
- run status/search/preflight
- fix validation errors inside scope
- record factual events after they happen
- retrieve a clearly matching artifact

## Good Agent Responses

When starting work:

```text
I will check pmem first: current project, relevant decisions, and preflight.
```

When memory blocks the requested approach:

```text
pmem has an active decision that conflicts with this approach: D-... .
I need direction before changing the architecture.
```

When multiple artifacts match:

```text
I found three frontend AGENTS.md templates. I will list them with scope, tags,
and last update so you can choose.
```

When recording durable knowledge:

```text
This is worth preserving for future agents, so I will record it as a decision
instead of a note.
```

## Minimal Tool Chains

Explain pmem:

```text
gateway.about
```

Get bundled manuals:

```text
gateway.manuals
```

Confirm collaboration:

```text
gateway.status
gateway.clients
```

Start task:

```text
project.current
task.next
preflight
task.update_status(status="doing")
```

Find previous knowledge:

```text
memory.search
decision.list
event.list
```

Find shared files:

```text
artifact.search
artifact.list
artifact.get
```

Record failed approach:

```text
failed_attempt.record
```

Finish task:

```text
task.update_status(status="done")
event.record, if important
decision.record, if a durable decision was made
decision.supersede, if replacing an old decision
artifact.put, if a reusable file should be shared
handoff.create, if another agent may continue the work
```

## Source Of Truth

Use these docs for deeper behavior:

- [TOOL_WORKFLOWS.md](TOOL_WORKFLOWS.md)
- [AGENT_STATE_MACHINE.md](AGENT_STATE_MACHINE.md)
- [MCP_TOOLS.md](MCP_TOOLS.md)
