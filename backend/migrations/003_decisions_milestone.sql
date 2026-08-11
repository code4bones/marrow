-- Companion to pg/052_decisions_milestone.cjs, for local-first (sqlite)
-- installs. Schema parity only: decision.repo.ts's INSERT/DecisionRow don't
-- read/write this column (same as the pre-existing "summary" field, which
-- is also gateway-only) -- this just keeps the two schemas from drifting.
ALTER TABLE decisions ADD COLUMN milestone TEXT;
