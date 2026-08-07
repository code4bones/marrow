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
