# Release Checklist

Use this checklist before publishing or deploying a package release.

## Version

- Package version was bumped intentionally.
- Changelog, docs, or release notes mention user-visible behavior.
- Generated lockfiles are in sync.

## Validation

- Typecheck passed.
- Lint passed.
- Unit tests passed.
- Relevant smoke tests passed.
- Package dry-run or build artifact inspection passed.

## Persistence

- Migrations were reviewed.
- Seed data changes are idempotent.
- Backup or rollback limits are documented.

## Deployment

- Install command is documented.
- Migration command is documented.
- Restart or reload command is documented.
- Health and readiness checks are documented.

## Memory

- Task status was updated.
- Important decisions were recorded.
- Failed attempts were recorded.
- Handoff was created when another agent may continue.
