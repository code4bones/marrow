# Project Memory MCP - Collaboration Conventions

This document defines working conventions for using Project Memory as a shared
collaboration layer between ChatGPT, Codex, and other agents.

The goal is to keep context durable, searchable, and useful without turning
Project Memory into a noisy chat log or raw command-output dump.

Project Memory should act as a shared project brain:

```text
ChatGPT <-> Project Memory <-> Codex / agents
```

## Core Principle

Use the right storage surface for the right kind of information.

- Short durable knowledge goes into `memory.*`.
- Architecture decisions go into `decision.*`.
- Executable work items go into `task.*`.
- Files and larger reusable documents go into `artifact.*`.
- Known mistakes go into `failed_attempt.*`.
- Compact session summaries go into `handoff.*`.

Do not store secrets, tokens, private keys, cookies, session data, raw
authorization headers, full `.env` files, passwords, or raw logs.

## Storage Mapping

### `memory.*`

Use for compact durable context:

- current status
- short project notes
- implementation summaries
- conventions
- constraints
- useful operational facts
- links to relevant artifacts or decisions

Good examples:

- `Current OAuth facade status`
- `ChatGPT Apps connector is installed and tested`
- `Use same-origin OAuth deployment for v1`
- `Codex should read latest handoff before touching PMem OAuth code`

Avoid:

- huge pasted files
- full terminal logs
- duplicate source code
- secrets

### `artifact.*`

Use for files and larger reusable documents:

- README files
- agent instructions
- design docs
- generated Markdown
- diagrams
- exports
- larger examples
- test fixtures
- files that Codex or ChatGPT should retrieve later

Recommended path style:

```text
<area>/<name>.md
<area>/<name>.json
<area>/<name>.txt
```

Examples:

```text
conventions/PROJECT_MEMORY_COLLABORATION.md
chatgpt-smoke/README.md
oauth/OAUTH_FACADE_FOR_CHATGPT_APPS.md
agents/CODEX_PROJECT_MEMORY.md
```

For Markdown documents, prefer:

```text
contentType: text/markdown; charset=utf-8
```

### `decision.*`

Use for durable architectural, product, or workflow decisions.

A decision should explain:

- what was decided
- why
- what alternatives were rejected
- consequences
- when to revisit

Good examples:

- `Use Project Memory as shared ChatGPT-Codex context layer`
- `Keep internal MCP_TOKEN server-side only`
- `Use OAuth facade with magic token for ChatGPT Apps`
- `Use broad memory:read memory:write scopes for v1`

Do not use decisions for temporary notes.

### `task.*`

Use for executable agent work.

A task should include:

- clear scope
- acceptance criteria
- allowed files if needed
- forbidden files if needed
- priority
- dependencies if any

Good examples:

- `Refine Project Memory collaboration conventions`
- `Add per-tool securitySchemes metadata`
- `Document exact ChatGPT connector setup values`
- `Add smoke test for artifact upload through ChatGPT Apps`

### `failed_attempt.*`

Use when something was tried and should not be repeated blindly.

Record:

- what was tried
- why it failed
- what not to repeat
- better next approach

Good examples:

- `Wildcard redirect URI rejected as unsafe`
- `Raw static bearer token cannot be used directly as ChatGPT App auth`
- `Search query wording triggered safety block; use neutral PMem queries`

Failed attempts matter because agents tend to retry plausible dead ends unless
they are explicitly recorded.

### `handoff.*`

Use at the end of a meaningful work session.

A handoff should include:

- what was completed
- files touched
- validation performed
- blockers
- next steps

Ideal collaboration flow:

```text
Codex finishes work
  -> writes handoff
ChatGPT starts discussion
  -> reads latest handoff
ChatGPT creates or updates docs/tasks
  -> writes artifact or memory
Codex continues
  -> reads preflight, handoff, and artifacts
```

## Start-Of-Work Protocol

Before doing non-trivial work, an agent should:

1. Resolve or set the current project when relevant.
2. Read the latest relevant handoff.
3. Run `context.pack` for a compact first pass.
4. Run `preflight.by_query` or search relevant memory when full context is needed.
5. Check known failed attempts.
6. Check relevant decisions.
7. Inspect artifacts if the task mentions docs, instructions, or generated
   files.
8. Then inspect repository files.

Suggested order:

```text
project.current / project.resolve
handoff or memory.search
context.pack
preflight.by_query
decision.list / decision.get
failed_attempt search
artifact.search / artifact.peek / artifact.read_text / artifact.put_text / artifact.get only if exact bytes are needed
repository inspection
```

Repository files remain the source of truth when memory conflicts with current
code.

## End-Of-Work Protocol

After meaningful work, write back only durable information.

Write one or more of:

- `handoff.create` for session summary
- `memory.upsert` for compact status or convention
- `decision.record` for durable architecture
- `artifact.put_text` for generated text files or docs
- `artifact.put` for binaries or exact byte artifacts
- `failed_attempt.record` for dead ends
- `task.update_status` for task lifecycle

Do not write Project Memory after every tiny edit.

## Conflict Policy

If Project Memory conflicts with repository state:

1. Prefer the current repository state.
2. Do not silently ignore the conflict.
3. Record a correction if stale memory is likely to mislead future agents.
4. Link or mention the corrected item if possible.

Use clear titles:

```text
Correction: <old assumption> is no longer true
```

## Naming Conventions

Use predictable titles.

Good titles:

```text
Project Memory Collaboration Conventions
Handoff: Project Memory OAuth facade for ChatGPT Apps
Decision: Use Project Memory as ChatGPT-Codex shared context layer
Failed attempt: Wildcard OAuth redirect URI
Status: ChatGPT Apps connector installed and tested
```

Avoid vague titles:

```text
notes
misc
stuff
latest
todo
important
```

## Tag Conventions

Use a small number of useful tags.

Recommended tags:

```text
chatgpt
codex
agent
pmem
project-memory
handoff
convention
oauth
artifact
gateway
prod
smoke-test
docs
```

Avoid tag spam.

## Security Rules

Never store:

- access tokens
- refresh tokens
- magic tokens
- `MCP_TOKEN`
- private keys
- cookies
- session IDs
- full `.env` files
- passwords
- personal secrets
- raw authorization headers

If a secret appears in a log, redact it before writing anything to Project
Memory.

Safe examples:

```text
MCP_TOKEN is kept server-side only.
PROJECT_MEMORY_OAUTH_PRIVATE_KEY_PEM exists but must not be stored in memory.
ChatGPT uses OAuth access tokens issued by the facade.
```

Unsafe examples:

```text
MCP_TOKEN=...
Authorization: Bearer ...
PROJECT_MEMORY_MAGIC_TOKEN=...
```

## Artifact Upload Rules

When ChatGPT or Codex creates a file that should be shared:

1. Store text files with `artifact.put_text`; use `artifact.put` only for binaries or exact bytes.
2. Use a clear path.
3. Use a clear title and description.
4. Add tags.
5. Prefer overwrite only when intentionally replacing the same logical file.
6. Optionally write a short memory record pointing to the artifact.

Example artifact path:

```text
conventions/PROJECT_MEMORY_COLLABORATION.md
```

## Minimal Shared Workflow

### ChatGPT Creates Context For Codex

```text
ChatGPT writes artifact:
  artifact.put_text path="conventions/PROJECT_MEMORY_COLLABORATION.md"

ChatGPT writes memory:
  memory.upsert title="Project Memory Collaboration Conventions uploaded"
```

### Codex Continues

```text
Codex searches:
  artifact.search query="Project Memory Collaboration Conventions"

Codex retrieves:
  artifact.peek id="..."
  artifact.read_text id="...", for Markdown/text content
  artifact.get id="...", only if exact base64 bytes are needed

Codex edits repo or updates PMem.

Codex writes handoff:
  handoff.create title="Handoff: refined Project Memory conventions"
```

### ChatGPT Resumes

```text
ChatGPT searches latest handoff.
ChatGPT summarizes next steps for the user.
```

## Healthy Usage

Project Memory usage is healthy when:

- future agents can understand current project state quickly
- durable decisions are easy to find
- handoffs are compact and useful
- artifacts hold reusable files instead of bloating memory records
- failed attempts prevent repeated mistakes
- secrets never enter memory
- repository state remains authoritative

## Confirmed Bridge Status

As of 2026-06-20:

- ChatGPT Apps connector can access the PMem gateway.
- ChatGPT can read and write memory records.
- ChatGPT can upload and retrieve artifacts.
- Codex can see artifacts uploaded by ChatGPT.
- Codex can write handoffs that ChatGPT can read.
- The bidirectional collaboration loop is working.

Confirmed bridge:

```text
ChatGPT <-> PMem memory/artifact <-> Codex
Codex -> PMem memory/artifact <-> ChatGPT
```

## Next Improvement Ideas

- Keep this document available through `gateway.manuals`.
- Make agents read these conventions before PMem-related work.
- Add a task template for PMem-backed handoffs.
- Add per-project artifact path conventions.
- Add finer OAuth scopes later if broad `memory:read memory:write` becomes too
  coarse.
