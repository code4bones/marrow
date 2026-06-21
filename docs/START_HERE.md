# PMemUI Start Here

This artifact is the handoff for a new frontend-agent session.

## Project

- PMem project slug: `pmem-ui`
- Product name: PMemUI
- Purpose: web UI for Project Memory gateway browsing, triage, diagnostics, and controlled maintenance.
- Source of truth: PMem gateway data and artifacts.

## Read First

1. `AGENTS.md` - project-specific frontend rules and FSD architecture.
2. `docs/FRONTEND_UI_CONCEPT.md` - product workflows, GraphQL boundary, UX rules, phases, acceptance criteria.
3. Active decisions for project `pmem-ui`.
4. Open tasks for project `pmem-ui`.
5. Known faults for project `pmem-ui`, if any.

## First Implementation Target

Start with a read-only explorer:

- Vite + React + TypeScript shell
- GraphQL client boundary
- gateway status and diagnostics
- project list
- selected project overview
- task, decision, artifact, and event read-only lists
- detail drawer with lazy full-body loading
- global search returning memory and artifact results

## Architecture Requirement

Use Feature-Sliced Design:

```text
src/app -> src/pages -> src/widgets -> src/features -> src/entities -> src/shared
```

Do not let lower layers import from higher layers.

## Important Constraints

- No landing page as the primary screen.
- No direct browser access to PostgreSQL.
- No role/ACL UI until backend supports roles.
- No base64 for text artifact previews or reads.
- Destructive actions require explicit confirmation.
- Keep UI quiet, dense, predictable, and useful for repeated developer work.
