# AGENTS.md

# PMemUI Frontend Agent Instructions

PMemUI is the future web interface for Project Memory (pmem/pm3m). It must make shared agent memory observable, searchable, and safe to maintain. It is an operational developer tool, not a marketing site and not a generic note-taking app.

## Required PMem Bootstrap

When starting a PMemUI session, use PMem first:

1. Select or inspect project `pmem-ui` / `PMemUI`.
2. Read this artifact: `AGENTS.md`.
3. Read `docs/START_HERE.md`.
4. Read `docs/FRONTEND_UI_CONCEPT.md` before designing screens or data flows.
5. Call preflight/context tools for the current task when available.
6. Search project memory for active decisions, known faults, handoffs, and current tasks before editing.

## Agent Role

The agent is a frontend implementation assistant. It should keep changes small, preserve backend contracts, and turn PMem records into a clear operational interface for developers and other agents.

Do not build a landing page. The first screen should be the usable application shell: project list, selected project overview, recent activity, and clear connection state.

## Stack

Use:

- React
- TypeScript
- Vite
- Zustand for UI/session state
- GraphQL for the browser-facing API boundary
- Generated GraphQL types where practical

Do not call PostgreSQL directly from the browser. The browser talks to GraphQL; GraphQL talks to the PMem gateway/service layer.

## Architecture: Feature-Sliced Design

Use FSD as the frontend architecture baseline:

```text
src/
  app/
    providers/
    router/
    styles/
  pages/
    projects/
    common/
    diagnostics/
  widgets/
    project-overview/
    navigation-rail/
    detail-drawer/
    global-search/
  features/
    project-select/
    task-status-update/
    task-delete/
    artifact-upload-text/
    artifact-read-text/
    memory-search/
  entities/
    project/
    task/
    decision/
    artifact/
    event/
    fault/
    client/
  shared/
    api/
    ui/
    lib/
    config/
    model/
```

Dependency direction:

```text
app -> pages -> widgets -> features -> entities -> shared
```

Lower layers must not import from higher layers. Keep API clients, generated GraphQL types, date formatting, common UI primitives, and config in `shared`. Keep business entity types and adapters in `entities`. Keep user actions in `features`. Compose screens in `pages` and application wiring in `app`.

## UX Rules

- Build an operational dashboard with dense tables, split-detail views, concise badges, and readable timestamps.
- Prefer tables and timelines over card grids.
- Do not nest cards inside cards.
- Do not use decorative gradients, hero sections, or illustrative empty states.
- Use visible confirmation for destructive actions.
- Never hide destructive actions behind hover-only controls.
- Load full record bodies and artifact text lazily.
- Use `artifact.peek` / `artifact.read_text` for text artifacts; do not request base64 for previews.

## State Rules

Use Zustand only for UI state:

- selected project
- selected record
- active filters
- table sorting
- drawer open/closed state
- confirmation dialog state
- recent search query
- display density

Server data belongs in the GraphQL query cache. Do not duplicate normalized server records in Zustand.

## Safety Rules

- PMem is shared company memory; destructive actions need explicit confirmation.
- Current auth model is trusted internal token access. Do not design role/ACL screens unless backend roles exist.
- Do not expose secrets from logs or artifacts.
- Missing backend capabilities should be disabled or absent, not mocked as real.

## Validation

Run the smallest relevant checks:

```bash
npm run typecheck
npm run lint
npm test
```

For layout or interaction changes, run the local app and verify key flows with browser screenshots or UI smoke checks.

## Imported Baseline Template

The common frontend template below remains applicable unless this PMemUI-specific file overrides it.

# AGENTS.md

# Frontend Project Agent Instructions

Use this template for web applications and frontend-heavy repositories.
Adapt the stack-specific commands and design system notes before use.

## Agent Role

The agent is a frontend implementation assistant. It should:

- preserve existing design system conventions
- build real usable screens instead of placeholder landing pages
- keep layouts responsive across mobile and desktop
- use existing component, icon, routing, and state patterns
- verify interactive UI in a browser when behavior or layout changes

## UX Rules

- Use feature-complete controls that match the workflow.
- Keep operational tools dense, predictable, and easy to scan.
- Avoid nested cards and decorative backgrounds that reduce usability.
- Ensure text does not overflow, overlap, or resize the layout unexpectedly.
- Use icons for familiar tool actions when the project has an icon library.
- Do not add visible instructional copy for basic UI behavior.

## Engineering Rules

- Prefer existing components over new primitives.
- Keep state close to the feature unless shared state already exists.
- Use structured APIs and typed models where available.
- Avoid global CSS changes unless the task is explicitly about them.
- Do not introduce a new UI framework without approval.

## Validation

Run the smallest relevant checks, for example:

```bash
npm run typecheck
npm run lint
npm test
```

For visual or interaction changes, also run the local app and verify key flows
with browser screenshots or automated UI checks when practical.
