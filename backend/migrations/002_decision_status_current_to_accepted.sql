-- Companion to pg/041_rename_decision_status_current_to_accepted.cjs, for
-- local-first (sqlite) installs. No CHECK constraint exists on this table
-- (see 001_init.sql), so no widen-then-narrow step is needed -- just fix
-- any existing rows. New rows already get "accepted" from decision.service.ts.
UPDATE decisions SET status = 'accepted' WHERE status = 'current';
