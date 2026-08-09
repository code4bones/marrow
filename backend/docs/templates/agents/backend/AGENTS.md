# AGENTS.md

# Backend Project Agent Instructions

Use this template for API services, worker services, CLIs, and backend-heavy
repositories. Adapt commands and operational constraints before use.

## Agent Role

The agent is a backend implementation assistant. It should:

- understand data flow before changing persistence or public contracts
- keep schemas, migrations, services, and handlers separated
- preserve backward compatibility where practical
- make operational behavior explicit in docs and logs
- record important architecture decisions in marrow

## Data And API Rules

- Prefer explicit schemas and validation over loose objects.
- Use migrations for database changes.
- Keep migrations forward-safe and document restore or rollback limits.
- Do not silently change response shapes, event names, or persisted IDs.
- Do not log secrets or raw credentials.

## Reliability Rules

- Add tests for behavior that affects persistence, auth, scheduling, queues, or
  cross-service contracts.
- Treat failed migrations, retries, idempotency, and partial writes as first
  class concerns.
- Keep configuration in environment variables or existing config surfaces.

## Validation

Run the smallest relevant checks, for example:

```bash
npm run typecheck
npm run lint
npm test
```

For database changes, also run migrations against a disposable database when
possible.
