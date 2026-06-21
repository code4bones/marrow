# Project Memory MCP — Agent Guide

This guide tells agents when and how to use Project Memory MCP (`pmem`).

Use it as an operating procedure. Do not treat pmem as a passive note database.
It is part of task execution.

## PMem Token Discipline

PMem tool results remain in the model context for the rest of the session. Use
PMem as a lazy index first, not as a document dump.

Default workflow:

```text
compact first -> select exact record/artifact -> read full content only by id/path -> compact after heavy reads
```

Prefer:

- `context.pack(profile="chatgpt", mode="brief"|"normal")` for ChatGPT-style compact starts
- `project.list(compact=true)` and `task.list(compact=true)` for selection
- `artifact.search(compact=true)` before broad `artifact.list`
- `artifact.list(compact=true, limit=<small number>)` for folder-like browsing
- small `artifact.peek` excerpts before `artifact.read_text`

Avoid during normal coding flow:

- broad list calls with high limits
- `artifact.read_text` before selecting a specific artifact
- `artifact.get(includeContent=true)` unless exact bytes/base64 are required
- `gateway.clients`, `gateway.diagnostics`, and other debug tools unless diagnosing PMem itself

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

For first-run onboarding, request the compact onboarding manual:

```text
gateway.manuals(audience="onboarding", includeContent=true)
```

For ChatGPT-Codex collaboration, handoffs, artifacts, or storage-surface
questions, request the conventions manual:

```text
gateway.manuals(audience="conventions", includeContent=true)
```

Default onboarding chain:

```text
gateway.about
gateway.status
gateway.version
gateway.manuals(audience="onboarding", includeContent=true)
gateway.manuals(audience="conventions", includeContent=true), for collaboration-heavy work
project.resolve
project.current or project.set_current
project.summary, for a compact project state card
context.pack, for a compact start-of-work package
context.changed_since, to refresh after a known cursor
preflight.by_query, or task.next -> task.get -> preflight
artifact.search, when shared templates or files are needed
```

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

## Storage Surface Mapping

Use the right pmem surface for the right kind of information:

- `memory.*` for compact durable knowledge, status, conventions, constraints,
  and links to related artifacts or decisions
- `decision.*` for durable architecture, product, and workflow decisions
- `task.*` for executable work with scope and acceptance criteria
- `artifact.*` for files, larger reusable documents, generated Markdown,
  diagrams, exports, fixtures, and templates
- `failed_attempt.*` for mistakes or dead ends that future agents should not
  repeat blindly
- `handoff.*` for compact session summaries with completed work, files,
  validation, blockers, and next steps

Do not store secrets, tokens, private keys, cookies, session IDs, full `.env`
files, raw authorization headers, or raw logs. Redact before writing if a secret
appears in diagnostic output.

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
task.claim(role=<your role>, scope=<your part>)
implement
validate
task.add_note, when you produced useful implementation/test/review context
task.claim_complete(claimId=<claim id>)
task.complete, only when acceptance is satisfied and no other active claims remain
event.record, if useful
memory.create / decision.record, only for durable knowledge
```

If no task exists but the user gave a concrete request:

```text
project.resolve, when repository identity is available
project.current
context.pack(query=<request>, mode="brief"|"normal")
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

## Task Claims

Use `task.claim` before implementation work on a recorded task. A claim is a
time-bounded lease for your part of the work, not ownership of the whole task.
Keep the returned `claim.id`; later calls use that handle even if the agent does
not know its own stable client id.

Use:

```text
task.claim(role="backend"|"frontend"|"test"|"docs"|"review"|"devops"|"coordination"|"other")
task.claim_heartbeat(claimId=<claim id>)
task.claim_complete(claimId=<claim id>)
task.release(claimId=<claim id>)
task.claims(taskId=<task id>)
```

Do not close a task just because your own claim is complete. Use
`task.complete` only when the task acceptance criteria are satisfied and no
other active claims remain. `task.complete` refuses to close a task with active
claims unless `force=true` is supplied with a reason or acceptance evidence.

Use `task.add_note` for durable task traces such as implementation notes,
handoffs, test results, and review notes. It creates an `I-*` item and links it
to the task; do not turn `tasks.notes` into a chat log.

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
  "path": "templates/agents/frontend/AGENTS.md"
}
```

Bundled templates are seeded on the gateway after `pm3m migrate latest`.
Clients do not have local template state; agents should search the gateway
before creating a new shared template:

```text
artifact.search query="frontend AGENTS template" includeCommon=true
artifact.peek id=<selected artifact id> excerptChars=1000
artifact.read_text id=<selected artifact id>, when the template text is needed
artifact.put_text path=<selected path> text=<updated Markdown>, when writing text changes
artifact.get id=<selected artifact id> includeContent=true, only if exact base64 bytes are needed
```

If a user asks for templates and `memory.search` returns `C-TEMPLATE-001`, treat
that record as a pointer to artifact-backed templates and switch to
`artifact.search` or `artifact.list`.

Use project artifacts for files specific to one project:

```json
{
  "project": "project-memory-mcp",
  "path": "docs/snapshots/architecture-2026-06-19.md"
}
```

For text or Markdown files, call `artifact.peek` first when orienting, then
`artifact.read_text` when the actual file text is needed. Both return no
`contentBase64`.

Use `artifact.put_text` when creating or updating Markdown/text artifacts. It
stores UTF-8 text directly and avoids base64.

Use `artifact.get(includeContent=true)` only when exact base64 file bytes are
actually needed.

For binary files or larger files, use the returned `downloadPath` and append it
to `GW_ENDPOINT`.

Ask before overwriting an artifact unless the user explicitly requested a
replacement.

If `artifact.put_text` or `artifact.put` returns `ARTIFACT_CONFLICT`, do not retry blindly. Inspect
`error.details.existing` and `error.details.suggestedActions`, then choose one
path:

- keep the existing artifact and use `artifact.read_text` or `artifact.get`
- ask for confirmation, then retry `artifact.put_text` or `artifact.put` with `overwrite=true`
- create a new versioned path such as `templates/name-v2.md`
- call `artifact.archive` on the old artifact, then `artifact.put_text` or `artifact.put` with the
  original path

Ask the user before replacing or archiving shared team artifacts.

Ask when multiple artifacts are plausible matches.

Use `artifact.update_metadata` when the bytes are correct but title,
description, or tags need cleanup.

Use `artifact.archive` instead of deleting shared files. Archived artifacts are
hidden from default search but remain retrievable by explicit id/path or
`includeArchived=true`.

Prefer clear artifact paths such as:

```text
conventions/PROJECT_MEMORY_COLLABORATION.md
oauth/OAUTH_FACADE_FOR_CHATGPT_APPS.md
agents/CODEX_PROJECT_MEMORY.md
```

For Markdown documents, use `contentType: text/markdown; charset=utf-8`.

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

Use `handoff.latest` at the start of continuation work before broad
`memory.search`. Use `handoff.search` when the handoff topic is known.

Use `project.summary` when you need a compact project-level snapshot before
deciding which task, handoff, artifact, or decision to read in full.

Use `context.changed_since` during long or resumed sessions when you already
have a `nextCursor` from a prior pmem response and only need incremental
changes.

Use `memory.hygiene_report` when project memory feels noisy, repetitive, or too
large. Treat it as a read-only report; do not archive or rewrite records without
reviewing the full records first.

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
context.pack(taskId=<task id>)
preflight
task.claim
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
artifact.peek
artifact.read_text
artifact.put_text
artifact.get
```

Record failed approach:

```text
failed_attempt.record
```

Finish task:

```text
task.add_note, if useful durable task context was produced
task.claim_complete
task.complete, only when the whole task is ready to close
event.record, if important
decision.record, if a durable decision was made
decision.supersede, if replacing an old decision
artifact.put_text, if a reusable text file should be shared
artifact.put, if binary or exact base64 bytes should be shared
handoff.create, if another agent may continue the work
```

Continue previous work:

```text
project.current
project.summary
handoff.latest
context.pack(query=<handoff topic>)
```

## Source Of Truth

Use these docs for deeper behavior:

- [PROJECT_MEMORY_COLLABORATION_CONVENTIONS.md](PROJECT_MEMORY_COLLABORATION_CONVENTIONS.md)
- [TOOL_WORKFLOWS.md](TOOL_WORKFLOWS.md)
- [AGENT_STATE_MACHINE.md](AGENT_STATE_MACHINE.md)
- [MCP_TOOLS.md](MCP_TOOLS.md)
