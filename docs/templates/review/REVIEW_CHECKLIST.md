# Review Checklist

Use this checklist for focused code review.

## Correctness

- The change matches the requested behavior.
- Edge cases and error paths are handled.
- Public APIs, response shapes, and persisted data remain compatible unless the
  change explicitly requires a break.
- Existing user data and user changes are preserved.

## Scope

- The diff is limited to the task.
- No unrelated formatting or refactoring is mixed into the change.
- New abstractions remove real complexity or match an existing pattern.

## Tests

- The smallest relevant automated checks were run.
- New behavior has tests when the blast radius is more than trivial.
- Manual validation steps are documented when automation is not practical.

## Operations

- Logs are useful and do not expose secrets.
- Config changes are documented.
- Migrations, deploy steps, and rollback limits are clear.

## Memory

- Important decisions were recorded.
- Failed attempts were recorded with what not to repeat.
- Follow-up work is captured as tasks or handoffs.
