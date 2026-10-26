exports.up = async function up(knex) {
  await knex.schema.raw("alter table tasks drop constraint if exists tasks_status_check");
  await knex.schema.raw("alter table tasks add constraint tasks_status_check check (status in ('todo','doing','blocked','clar','review','changes_requested','done','cancelled'))");
};
exports.down = async function down(knex) {
  await knex("tasks").where({ status: "clar" }).update({ status: "blocked" });
  await knex.schema.raw("alter table tasks drop constraint if exists tasks_status_check");
  await knex.schema.raw("alter table tasks add constraint tasks_status_check check (status in ('todo','doing','blocked','review','changes_requested','done','cancelled'))");
};
