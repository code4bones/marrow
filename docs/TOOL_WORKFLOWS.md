# Project Memory MCP — Tool Workflows

This document describes recommended tool chains for agents using Project Memory MCP.

The tools are intentionally small. Agents should combine them into predictable workflows instead of treating them as unrelated commands.

## Session Start

Use this when an agent starts work in a repository.

```text
project.resolve, when repository path/slug/remote is known
project.current
project.summary
context.changed_since, only when resuming from a stored cursor
```

When memory quality is the problem, inspect before mutating:

```text
memory.hygiene_report
memory.get, only for records selected by nextCalls
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

When continuing previous work, load recent handoffs before broad search:

```text
project.summary
handoff.latest
handoff.search, when the topic is known
```

For collaboration-heavy work, load the conventions manual before editing:

```text
gateway.manuals(audience="conventions", includeContent=true)
```

Use it when the task involves ChatGPT-Codex handoff, shared artifacts,
cross-agent context, or choosing the correct pmem storage surface.

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
task.claim(role=<your role>, scope=<your part>)
```

Then work only inside the task scope.

After implementation:

```text
task.add_note, if durable implementation/test/review context was produced
task.claim_complete(claimId=<claim id>)
task.complete, only when acceptance is satisfied and no active claims remain
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

Write back only durable information. Do not create pmem records for every small
edit or transient observation.

## Storage Surface Selection

Use this before recording new information:

```text
memory.upsert       compact durable status, conventions, constraints, links
decision.record     durable architecture, product, or workflow decisions
task.create         executable work with scope and acceptance criteria
artifact.put_text   generated docs, Markdown, templates, text fixtures
artifact.put        binary files or exact byte transport
failed_attempt.record
                    failed approaches that should not be repeated blindly
handoff.create      compact session summary for another agent or future session
```

Purpose:

- prevent `memory.*` from becoming a chat log
- keep files and larger reusable documents in artifact storage
- keep decisions and failed attempts first-class
- make later preflight output useful

## Research And Planning

Use this before changing design or implementation strategy.

```text
project.current
context.pack(query=<topic>, mode="brief"|"normal")
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

`context.pack` is the token-conscious first pass. It returns compact cards,
known-fault stop-signals, artifact metadata, and next tool calls. Use the
follow-up tools it suggests only when full details are needed.

For ChatGPT or other contexts where every tool result stays in the session,
prefer:

```text
context.pack(profile="chatgpt", mode="brief"|"normal")
artifact.search(compact=true)
artifact.list(compact=true, limit=<small number>)
artifact.peek(excerptChars=1000)
```

Use full `artifact.read_text`, manual content, and high-limit debug lists only
after selecting exact records. Compact the chat after large reads.

## Fault Recording

Use this when an approach fails in a way future agents should not repeat.
`failed_attempt.record` is the canonical fault-recording tool.

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

- make future `preflight` and `preflight.by_query` calls expose the record as
  `knownFaults`
- prevent agents from retrying the same broken approach
- preserve the better next approach while context is fresh
- make failure searchable
- attach it to a task, decision, or item
- include it in future preflight output

## Known Fault Handling

Use this before repeating any risky command, deploy path, migration, tool chain,
or integration workflow:

```text
preflight
preflight.by_query
```

Purpose:

- inspect `knownFaults`
- stop before repeating a matching `doNotRepeat`
- choose a different next approach or ask for direction

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
artifact.peek
artifact.read_text, for Markdown/text content
artifact.get, only if exact base64 bytes are needed
```

Use this when searching by meaning:

```text
artifact.search
artifact.peek
artifact.read_text, for Markdown/text content
artifact.get, only if exact base64 bytes are needed
```

After upload:

```text
artifact.update_metadata, if title/description/tags need cleanup
artifact.archive, if a shared file is superseded but should remain retrievable
```

If upload returns `ARTIFACT_CONFLICT`:

```text
artifact.peek, to inspect the existing artifact without base64 content
ask user, unless the requested action already explicitly says replace/archive
artifact.put_text(overwrite=true), for text replacement after confirmation
artifact.put(overwrite=true), for binary/exact bytes after confirmation
artifact.put_text(path="...-v2.md"), when keeping both text versions is better
artifact.archive -> artifact.put_text, when the old text path should point at the new file
```

Purpose:

- keep reusable files discoverable
- avoid overwriting shared artifacts accidentally
- preserve old files through archival instead of deletion

Recommended artifact paths are stable and area-prefixed:

```text
conventions/PROJECT_MEMORY_COLLABORATION.md
oauth/OAUTH_FACADE_FOR_CHATGPT_APPS.md
agents/CODEX_PROJECT_MEMORY.md
```

For Markdown documents, prefer `contentType: text/markdown; charset=utf-8`.

## ChatGPT-Codex Collaboration Loop

Use this when ChatGPT and Codex are collaborating through the shared gateway:

```text
ChatGPT creates context:
  artifact.put_text, for shared docs/text files
  artifact.put, for binaries or exact byte artifacts
  memory.upsert, for compact status or pointers

Codex continues:
  gateway.manuals(audience="conventions", includeContent=true)
  project.summary
  handoff.latest / handoff.search
  artifact.search / artifact.peek / artifact.read_text / artifact.get only when exact bytes are needed
  preflight.by_query
  repository inspection

Codex finishes:
  handoff.create
  task.update_status / event.record / decision.record, as needed

ChatGPT resumes:
  memory.search or handoff lookup
  summarize next steps for the user
```

Repository files remain authoritative if they conflict with pmem records.

## Default Agent Chain

For most implementation tasks, use:

```text
project.resolve, if repository identity is available
project.current
task.next
context.pack(taskId=<task id>, mode="brief"|"normal")
preflight
task.claim(role=<your role>, scope=<your part>)
memory.search, if more context is needed
decision.get or memory.get, if ids from preflight/knownFaults need full detail
implement
npm run lint / typecheck / test / build, as appropriate
task.add_note, if durable implementation/test/review context was produced
task.claim_complete(claimId=<claim id>)
task.complete, only when acceptance is satisfied and no active claims remain
memory.upsert / decision.record / decision.supersede / event.record, if new durable knowledge exists
handoff.create, if another agent or later session may continue the work
```

If anything blocks completion:

```text
task.update_status(status="blocked", note="...")
failed_attempt.record, if an approach should not be repeated
```
