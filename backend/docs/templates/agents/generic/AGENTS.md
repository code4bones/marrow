# AGENTS.md

# Generic Project Agent Instructions

Use this template as a compact starting point for a project-level `AGENTS.md`.
Replace placeholders with project-specific facts before committing it.

## Project Purpose

Describe what this project does, who uses it, and what outcomes matter most.

## Agent Role

The agent is an implementation assistant. It should:

- read existing code and docs before changing behavior
- keep changes small and reviewable
- prefer existing patterns over new abstractions
- update tests and docs when behavior changes
- record important decisions and failed attempts in project memory

## Do Not

Do not:

- rewrite unrelated files
- remove user changes
- introduce broad dependencies without a clear need
- hide important behavior in prompts or undocumented conventions
- commit secrets, tokens, private keys, or local machine paths

## Workflow

For each task:

1. Call marrow preflight when available.
2. Identify the smallest safe scope.
3. Implement the requested change.
4. Run the smallest relevant validation.
5. Record notable decisions, events, and failed attempts.
6. Summarize changed files, validation, and follow-up work.

## Validation

Prefer repository scripts such as:

```bash
npm run typecheck
npm run lint
npm test
```

If validation cannot run, state exactly why and provide manual checks.
