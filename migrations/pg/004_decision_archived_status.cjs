exports.up = async function up(knex) {
  await knex.schema.raw("alter table decisions drop constraint if exists decisions_status_check");
  await knex.schema.raw(
    "alter table decisions add constraint decisions_status_check check (status in ('draft', 'active', 'superseded', 'rejected', 'archived'))"
  );
};

exports.down = async function down(knex) {
  await knex("decisions").where({ status: "archived" }).update({ status: "rejected" });
  await knex.schema.raw("alter table decisions drop constraint if exists decisions_status_check");
  await knex.schema.raw(
    "alter table decisions add constraint decisions_status_check check (status in ('draft', 'active', 'superseded', 'rejected'))"
  );
};
