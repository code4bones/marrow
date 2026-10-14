# Marrow ↔ TellyMCP: generic MCP inbox

Status: architecture proposal, agreed direction. This document deliberately
describes a generic TellyMCP capability; it is not a request to hard-code
Marrow-specific domain logic into TellyMCP.

## Product flow

1. A project member assigns a Marrow task to another member.
2. Marrow validates that the assignment is eligible for delivery, records its
   normal task/event state, and persists an outgoing delivery job.
3. The Marrow dispatcher calls TellyMCP's `inbox.put` MCP tool.
4. TellyMCP persists the generic inbox record, wakes its worker through
   PostgreSQL `NOTIFY`, resolves the recipient and their preferred live agent
   session, and renders the supplied display snapshot.
5. TellyMCP asks the recipient in Telegram whether the agent should perform
   the work.
6. On **Approve**, TellyMCP materializes an xchange record for the target
   session and sends a fixed safe PTY nudge to its agent.
7. The agent reads the xchange payload, verifies current task state, calls
   `task.claim`, performs the work, and updates Marrow normally. Existing
   Marrow chat/Telegram/realtime notifications then report progress.
8. On **Reject**, TellyMCP records the rejection in its own inbox state. No
   agent nudge is sent.

```text
Marrow task assignment
        |
        v
Marrow outbox -- inbox.put --> Telly generic PostgreSQL inbox
                                    |
                                  NOTIFY
                                    |
                                    v
                           Telegram Approve / Reject
                            |                    |
                            v                    v
                       xchange + PTY        inbox response
                            |
                            v
                     agent: task.claim -> work -> Marrow updates
```

## Ownership boundaries

### Marrow

- Remains the source of truth for projects, tasks, assignees, task lifecycle,
  permissions, and audit events.
- Decides which task events create an external delivery offer.
- Owns reliable delivery retry through a local persistent outbox.
- Supplies a bounded, presentation-ready snapshot with each inbox offer.

### TellyMCP

- Owns the generic inbox, recipient/session resolution, Telegram UI, xchange
  records, and PTY nudge.
- Is an MCP *server* for `inbox.*` tools. It has no outbound MCP client in
  v1.
- Does not contain Marrow task tables, task-specific SQL, or branches such as
  `if (source === "marrow")`.
- Never executes arbitrary shell text or arbitrary MCP calls supplied by a
  message payload.

### Agent

- Is the only component that starts actual implementation work.
- Re-reads and claims the task from its own authenticated Marrow MCP
  connection before editing. Telegram approval authorizes a wake-up; it is not
  a task claim.

## Generic TellyMCP inbox contract

TellyMCP should provide a generic inbox rather than a Marrow endpoint. A
source places a durable, idempotent message with `inbox.put`; the message
contains the bounded display data necessary for the inbox worker to present it
without calling the source.

Illustrative message envelope:

```json
{
  "source": {
    "integration": "marrow",
    "messageId": "E-MARROW-123"
  },
  "recipient": {
    "externalPrincipal": {
      "namespace": "marrow",
      "subject": "U-MARROW-456"
    }
  },
  "route": {
    "namespace": "marrow",
    "key": "P-MARROW-42"
  },
  "resource": {
    "kind": "task",
    "id": "T-MARROW-123"
  },
  "kind": "work.offer",
  "requiresAcceptance": true,
  "display": {
    "title": "Implement the inbox delivery",
    "summary": "Add a durable delivery worker.",
    "status": "todo",
    "priority": 50,
    "milestone": "Telly inbox",
    "acceptance": "The dispatcher retries safely.",
    "project": { "id": "P-MARROW-42", "title": "Marrow" },
    "task": { "id": "T-MARROW-123" }
  }
}
```

`integration`, `namespace`, and `kind` are data, not source code branches.
The optional future `operations` object is reserved for a later protocol
version; TellyMCP v1 ignores it and never treats it as executable authority.

The envelope must be versioned before implementation (for example,
`schemaVersion: 1`).

## Required generic TellyMCP capabilities

- `inbox.put`: durable insert, deduplicated by
  `(source.integration, source.messageId)`.
- `inbox.responses` (or an equivalent cursor-based read API): lets a source
  retrieve accepted/rejected/delivered/failed outcomes.
- `inbox.bind_identity`: maps an opaque external principal
  `(namespace, subject)` to a TellyMCP user.
- `inbox.bind_route`: maps an external route and user to a preferred agent
  console. A recipient with several terminals needs one preferred session to
  avoid waking two agents for one task.
- Telegram/web actions for accept and reject, and conversion of an approved
  message into an xchange record plus a fixed PTY nudge.

Suggested internal persistence is `inbox_messages`,
`inbox_external_principals`, and `inbox_route_bindings`. Exact names are a
TellyMCP concern.

`LISTEN` is a PostgreSQL channel operation, not a table operation. The inbox
table's trigger should call `pg_notify('inbox_ready', inbox_id)`; the worker
then loads and locks the durable row. The notification is only a wake-up: the
database row is what survives restarts and permits retry.

## Integration safety rules

- Marrow calls TellyMCP through a dedicated integration MCP credential with a
  narrow scope such as `inbox:send`; it does not receive Telly's general
  gateway token or database credentials.
- TellyMCP v1 does not execute source MCP calls at all. A payload is data, and
  no payload field grants executable authority.
- PTY input is a fixed nudge such as “A newly approved inbox item is ready;
  read its xchange record.” Full task data remains in the xchange record; it
  is never injected as terminal commands.
- The agent re-checks the task and performs `task.claim` itself. This handles
  stale/changed/cancelled tasks and prevents Telegram approval from becoming a
  covert execution primitive.

## Marrow-specific delivery policy

Initial scope: only a task assignment addressed to a different human should
create a `work.offer`. The relevant comparison is normally assignee versus
the authenticated assignment actor, not merely assignee versus project owner:
an owner can legitimately be assigned work by another member.

The implementation must use a stable human actor identity for static-token
agent calls as well; it must not infer identity from labels or email strings.
The existing `telegram_identities` binding is a suitable verified identity
bridge to TellyMCP's Telegram-backed user identity, but the generic inbox API
uses opaque external principal ids and does not depend on Telegram itself.

In v1 inbox acceptance is a Telly-local authorization to wake an agent; it is
not written back to Marrow. A future, explicitly versioned protocol may add
dedicated Marrow accept/reject operations rather than use a general task
mutation. The distinction remains explicit:

- assignment offer accepted: the human authorized waking their agent;
- task claimed: the agent actually began work;
- task completed/updated: existing Marrow lifecycle behavior.

## Reliability and outcomes

The Marrow task mutation must not fail merely because TellyMCP is temporarily
unavailable. It persists a local outbox item before attempting remote delivery,
and a dispatcher retries `inbox.put` with the event id as its idempotency key.

The local Marrow outbox outcome should be visible in Marrow for diagnosis:

- pending delivery;
- delivered to TellyMCP;
- failed after retry budget.

No reverse task-status synchronization is required for the first slice: after
the nudge, the agent uses Marrow's existing MCP tools, so existing Marrow
events and notifications already remain authoritative.

## Marrow v1 configuration

Delivery is disabled unless both variables are configured; task assignment
continues normally when they are absent.

- `TELLYMCP_INBOX_MCP_URL`: TellyMCP Streamable HTTP MCP endpoint, normally
  its `/mcp` URL.
- `TELLYMCP_INBOX_BEARER_TOKEN`: credential scoped to `inbox.put`.
- `TELLYMCP_INBOX_POLL_INTERVAL_MS` (optional): outbox polling interval;
  default `10000`, bounded to 1–300 seconds.
- `TELLYMCP_INBOX_MAX_ATTEMPTS` (optional): delivery retry budget; default
  `12`, bounded to 1–100.

## Proposed first vertical slice

1. Implement generic `inbox.put` and durable worker/Telegram approval in
   TellyMCP.
2. Add explicit identity and preferred-session route bindings.
3. Add Marrow assignment-offer/outbox records and the `task.assigned` →
   `inbox.put` dispatcher, including the complete `display` snapshot.
4. On acceptance, write an xchange record, nudge the selected agent, and
   verify that it claims/updates the task through existing Marrow tools.
