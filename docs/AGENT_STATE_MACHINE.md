# Project Memory MCP — Agent State Machine

This document defines a practical state machine for agents using Project Memory MCP.

The goal is not to force agents into rigid behavior. The goal is to make the default path deterministic and reserve user clarification for actual ambiguity, conflict, or scope risk.

## State Overview

```text
S0_NO_PROJECT
S1_PROJECT_SELECTED
S2_TASK_SELECTED
S3_PREFLIGHT_READY
S4_EXECUTING
S5_VALIDATING
S6_COMPLETED
S7_BLOCKED
S8_RECORDING_MEMORY
```

## Transition Table

| State | Condition | Tool Chain | Next State | Ask User When |
| --- | --- | --- | --- | --- |
| `S0_NO_PROJECT` | Current project may exist | `project.current` | `S1_PROJECT_SELECTED` | Never, if current project exists |
| `S0_NO_PROJECT` | No current project | `project.list` | `S0_NO_PROJECT` | Multiple plausible projects exist and none is clearly the target |
| `S0_NO_PROJECT` | Project missing and repository identity is clear | `project.create -> project.set_current` | `S1_PROJECT_SELECTED` | Repository identity or project title is unclear |
| `S1_PROJECT_SELECTED` | Agent needs next queued work | `task.next` | `S2_TASK_SELECTED` | No todo task exists and user did not provide a task |
| `S1_PROJECT_SELECTED` | User referenced a task id | `task.get` | `S2_TASK_SELECTED` | Task does not exist |
| `S1_PROJECT_SELECTED` | User asks broad research/planning | `memory.search -> decision.list -> event.list` | `S1_PROJECT_SELECTED` | Found decisions or failed attempts conflict with user request |
| `S2_TASK_SELECTED` | Task scope is usable | `preflight` | `S3_PREFLIGHT_READY` | Task has missing or contradictory scope/acceptance criteria |
| `S2_TASK_SELECTED` | Task has dependencies | `task.get -> link.list -> preflight` | `S3_PREFLIGHT_READY` | Dependency is blocked, missing, or contradicts requested work |
| `S3_PREFLIGHT_READY` | Scope is clear and no conflicts | `task.update_status(status="doing")` | `S4_EXECUTING` | Preflight shows forbidden scope, conflicting decisions, or relevant failed attempts that make the requested approach unsafe |
| `S4_EXECUTING` | Implementation proceeds normally | Local edits and validation commands | `S5_VALIDATING` | Required file changes exceed allowed scope |
| `S4_EXECUTING` | Approach fails in a reusable way | `memory.create(type="failed_attempt") -> event.record(type="attempt.failed")` | `S7_BLOCKED` or `S4_EXECUTING` | Need user decision between alternative approaches |
| `S5_VALIDATING` | Validation passes | `task.update_status(status="done")` | `S6_COMPLETED` | Never |
| `S5_VALIDATING` | Validation fails and fix is in scope | Local edits and validation commands | `S4_EXECUTING` | Fix requires forbidden files, new scope, or architecture decision |
| `S5_VALIDATING` | Validation fails and fix is out of scope | `task.update_status(status="blocked")` | `S7_BLOCKED` | Always include concise blocker details |
| `S6_COMPLETED` | New durable knowledge exists | `memory.create / decision.record / event.record / link.create` | `S8_RECORDING_MEMORY` | Only if deciding what should become durable memory is ambiguous |
| `S8_RECORDING_MEMORY` | Memory recorded | `event.list` if verification is needed | `S6_COMPLETED` | Never |
| `S7_BLOCKED` | User gives direction | `task.get -> preflight` | `S3_PREFLIGHT_READY` | Direction is still ambiguous or conflicts with project decisions |

## Default Autonomous Path

When the user asks the agent to continue normal project work, use:

```text
project.current
task.next
preflight
task.update_status(status="doing")
implement
validate
task.update_status(status="done")
record durable memory if needed
```

This path should not require clarification when:

- current project exists
- a todo task exists
- preflight returns no blocking conflict
- requested edits fit task scope
- validation failures are fixable within scope

## Clarification Triggers

Ask the user before continuing when any of these guard conditions are true:

- no current project exists and multiple plausible projects are registered
- no task exists and the user did not provide a concrete task
- task acceptance criteria are empty or contradictory
- task `allowedFiles` and `forbiddenFiles` conflict
- requested work requires forbidden files
- requested work is broader than task scope
- preflight returns an active decision that conflicts with the request
- preflight returns a failed attempt that matches the intended approach
- a dependency is blocked or missing
- validation failure requires an architectural decision
- multiple valid implementation strategies have materially different product or architecture consequences

Do not ask the user when the agent can safely:

- select the current project
- choose `task.next`
- run `preflight`
- update task status to `doing`
- fix validation failures within allowed scope
- record factual events or failed attempts after they happen

## Memory Recording Rules

Use durable memory only when the information should influence future work.

Use `decision.record` for:

- architectural decisions
- product decisions
- workflow decisions
- rejected or superseded decisions with rationale

Use `memory.create` for:

- reusable notes
- failed attempts
- patterns
- snippets
- entities
- workflow rules
- common project facts

Use `event.record` for:

- append-only history
- failures worth remembering
- migrations
- manual milestones not already captured automatically

Use `link.create` for:

- `depends_on`
- `warns_against`
- `relates_to`
- `supersedes`
- `blocks`
- `references`

## State Machine In Common Memory

Seeded common records mirror the most important parts of this state machine:

- `C-AGENT-STATE-001`: Start by resolving current project
- `C-AGENT-STATE-002`: Select task before preflight
- `C-AGENT-STATE-003`: Run preflight before editing
- `C-AGENT-STATE-004`: Ask only on guard conflicts
- `C-AGENT-STATE-005`: Record blocked or failed attempts

Agents can retrieve these rules with:

```text
memory.search(query="agent state machine guard conflicts")
```
