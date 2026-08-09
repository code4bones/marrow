// Owner's call: "active" as a status for decisions/memory items/artifacts
// reads as "work in progress" (matching how it's used for projects/users/
// task_claims), when it actually means "this record is currently valid,
// not superseded/rejected/archived" -- e.g. a decision that's already been
// made and is still in force. Confusing for humans reading the UI and for
// agents reading raw status strings out of MCP tool responses alike.
//
// Renamed to "current" for decisions, items (memory), and artifacts only.
// Deliberately NOT touched: users.status, projects.status, task_claims.status
// -- "active" is the correct, unambiguous word for all three of those
// (a user allowed to log in, a project with ongoing work, a claim someone
// currently holds), so renaming them would introduce the exact same
// confusion in the opposite direction.
//
// This is a real breaking change for any existing MCP client/script that
// filters by status="active" on decision.list/memory.search/artifact.search
// -- accepted explicitly by the owner in exchange for correctness over a
// pure UI-label fix.
exports.up = async function up(knex) {
  // Constraints must allow "current" before any row is updated to it --
  // the old constraints only allow "active", so updating data first fails.
  await knex.schema.raw("alter table decisions drop constraint if exists decisions_status_check");
  await knex.schema.raw(
    "alter table decisions add constraint decisions_status_check check (status in ('draft', 'active', 'current', 'superseded', 'rejected', 'archived'))"
  );

  await knex.schema.raw("alter table items drop constraint if exists items_status_check");
  await knex.schema.raw(
    "alter table items add constraint items_status_check check (status in ('active', 'current', 'draft', 'archived', 'superseded', 'rejected', 'open', 'answered'))"
  );

  await knex.schema.raw("alter table artifacts drop constraint if exists artifacts_status_check");
  await knex.schema.raw(
    "alter table artifacts add constraint artifacts_status_check check (status in ('active', 'current', 'archived'))"
  );

  await knex("decisions").where({ status: "active" }).update({ status: "current" });
  await knex("items").where({ status: "active" }).update({ status: "current" });
  await knex("artifacts").where({ status: "active" }).update({ status: "current" });

  // Tighten the constraints now that no row uses "active" anymore.
  await knex.schema.raw("alter table decisions drop constraint if exists decisions_status_check");
  await knex.schema.raw(
    "alter table decisions add constraint decisions_status_check check (status in ('draft', 'current', 'superseded', 'rejected', 'archived'))"
  );

  await knex.schema.raw("alter table items drop constraint if exists items_status_check");
  await knex.schema.raw(
    "alter table items add constraint items_status_check check (status in ('current', 'draft', 'archived', 'superseded', 'rejected', 'open', 'answered'))"
  );

  await knex.schema.raw("alter table artifacts drop constraint if exists artifacts_status_check");
  await knex.schema.raw("alter table artifacts add constraint artifacts_status_check check (status in ('current', 'archived'))");
};

exports.down = async function down(knex) {
  // Same ordering constraint in reverse: widen the check first so both
  // "current" (existing rows) and "active" (target rows) validate while
  // the data update runs.
  await knex.schema.raw("alter table artifacts drop constraint if exists artifacts_status_check");
  await knex.schema.raw(
    "alter table artifacts add constraint artifacts_status_check check (status in ('active', 'current', 'archived'))"
  );

  await knex.schema.raw("alter table items drop constraint if exists items_status_check");
  await knex.schema.raw(
    "alter table items add constraint items_status_check check (status in ('active', 'current', 'draft', 'archived', 'superseded', 'rejected', 'open', 'answered'))"
  );

  await knex.schema.raw("alter table decisions drop constraint if exists decisions_status_check");
  await knex.schema.raw(
    "alter table decisions add constraint decisions_status_check check (status in ('draft', 'active', 'current', 'superseded', 'rejected', 'archived'))"
  );

  await knex("artifacts").where({ status: "current" }).update({ status: "active" });
  await knex("items").where({ status: "current" }).update({ status: "active" });
  await knex("decisions").where({ status: "current" }).update({ status: "active" });

  await knex.schema.raw("alter table artifacts drop constraint if exists artifacts_status_check");
  await knex.schema.raw("alter table artifacts add constraint artifacts_status_check check (status in ('active', 'archived'))");

  await knex.schema.raw("alter table items drop constraint if exists items_status_check");
  await knex.schema.raw(
    "alter table items add constraint items_status_check check (status in ('active', 'draft', 'archived', 'superseded', 'rejected', 'open', 'answered'))"
  );

  await knex.schema.raw("alter table decisions drop constraint if exists decisions_status_check");
  await knex.schema.raw(
    "alter table decisions add constraint decisions_status_check check (status in ('draft', 'active', 'superseded', 'rejected', 'archived'))"
  );
};
