# Project Memory MCP — Roadmap

This roadmap records the next implementation priorities for the shared gateway.

The guiding rule is to add tools that make pmem safer and more reliable for
multiple developers and agents, not to grow the tool list for its own sake.

## Priority 1 — Operations

1. `gateway.version`
   - Return package name, package version, tool count, storage mode, and runtime
     identity.
   - Help agents and operators confirm which gateway build they are using.

2. `gateway.diagnostics`
   - Return a safe runtime summary: mode, storage, readiness, migrations,
     record counts, artifact configuration, logging configuration, and package
     version.
   - Never return secrets such as `MCP_TOKEN`, PostgreSQL password, or bearer
     credentials.

3. `gateway.backup_manifest`
   - Return the operational backup surface: PostgreSQL database, artifact
     directory, artifact counts/sizes, and schema migration state.
   - This should not perform backup itself.

## Priority 2 — Memory Quality

4. `memory.upsert`
   - Make memory creation idempotent by `id` or a stable natural key.
   - Reduce duplicate common/project records created by agents.

5. `failed_attempt.record`
   - First-class tool for failed attempts instead of relying on
     `memory.create(type="failed_attempt")`.
   - Include what was tried, why it failed, what not to repeat, and better next
     approach.

6. `decision.supersede`
   - Create a replacement decision, mark the old decision as `superseded`, and
     add the appropriate link/event records in one operation.

7. `project.resolve`
   - Resolve a likely project from repository path, slug, title, or remote URL.
   - Return candidates instead of guessing when ambiguous.

## Priority 3 — Artifacts

8. `artifact.update_metadata`
   - Update title, description, and tags without re-uploading bytes.

9. `artifact.archive`
   - Prefer lifecycle archival over hard delete for shared files.

10. `artifact.list`
    - List artifacts by project/common scope, path prefix, and tags.
    - Search remains for fuzzy lookup; list is for navigation.

## Priority 4 — Agent UX

11. Extend onboarding output
    - `gateway.about` or a separate onboarding tool should return connection
      snippets for Codex, Claude, CodeWhale, and generic Streamable HTTP clients.

12. `preflight.by_query`
    - Return preflight-like context for ad-hoc work before a task exists.
    - Include decisions, failed attempts, common rules, and matching artifacts.

13. `handoff.create`
    - Let an agent leave a compact handoff: work completed, files touched,
      blockers, validation, and next steps.

## Current Implementation Order

Start with:

1. `gateway.version`
2. `gateway.diagnostics`
3. `memory.upsert`
4. `failed_attempt.record`

These deliver operational visibility first, then reduce duplicate and low-quality
memory records.
