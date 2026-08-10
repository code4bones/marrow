// Owner's call: decisions.status="current" reads as "the current one" (vs.
// older versions) when it actually means "adopted, in force" -- the ADR
// convention (proposed/accepted/superseded/rejected/deprecated) names that
// state "accepted" unambiguously. Scoped to decisions only -- "current" is
// kept as-is for items (memory) and artifacts, where it means "not archived"
// and "accepted" would not fit (a memory note or artifact isn't "accepted").
//
// This is a real breaking change for any existing MCP client/script that
// filters by status="current" on decision.list/decisionsPage.
exports.up = async function up(knex) {
  // Constraint must allow "accepted" before any row is updated to it.
  await knex.schema.raw("alter table decisions drop constraint if exists decisions_status_check");
  await knex.schema.raw(
    "alter table decisions add constraint decisions_status_check check (status in ('draft', 'current', 'accepted', 'superseded', 'rejected', 'archived'))"
  );

  await knex("decisions").where({ status: "current" }).update({ status: "accepted" });

  // Tighten the constraint now that no row uses "current" anymore.
  await knex.schema.raw("alter table decisions drop constraint if exists decisions_status_check");
  await knex.schema.raw(
    "alter table decisions add constraint decisions_status_check check (status in ('draft', 'accepted', 'superseded', 'rejected', 'archived'))"
  );
};

exports.down = async function down(knex) {
  await knex.schema.raw("alter table decisions drop constraint if exists decisions_status_check");
  await knex.schema.raw(
    "alter table decisions add constraint decisions_status_check check (status in ('draft', 'current', 'accepted', 'superseded', 'rejected', 'archived'))"
  );

  await knex("decisions").where({ status: "accepted" }).update({ status: "current" });

  await knex.schema.raw("alter table decisions drop constraint if exists decisions_status_check");
  await knex.schema.raw(
    "alter table decisions add constraint decisions_status_check check (status in ('draft', 'current', 'superseded', 'rejected', 'archived'))"
  );
};
