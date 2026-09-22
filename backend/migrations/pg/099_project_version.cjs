// Owner ask (2026-09-23): tie every record to "what version of the
// underlying project it belongs to" (agent-supplied, e.g. read from
// package.json), plus one "current/actual version" per project.
//
// Deliberately NOT reusing the existing `version` integer column already
// present on projects/items/tasks/decisions/links -- that one is an
// internal optimistic-lock revision counter (defaultTo(1), server-bumped),
// unrelated to a human-meaningful software version string. New columns use
// distinct names to avoid any confusion with it.
exports.up = async function up(knex) {
  await knex.schema.alterTable("projects", (table) => {
    table.text("last_version");
  });
  await knex.schema.alterTable("tasks", (table) => {
    table.text("project_version");
  });
  await knex.schema.alterTable("decisions", (table) => {
    table.text("project_version");
  });
  await knex.schema.alterTable("items", (table) => {
    table.text("project_version");
  });
  await knex.schema.alterTable("skills", (table) => {
    table.text("project_version");
  });
  await knex.schema.alterTable("artifacts", (table) => {
    table.text("project_version");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("projects", (table) => {
    table.dropColumn("last_version");
  });
  await knex.schema.alterTable("tasks", (table) => {
    table.dropColumn("project_version");
  });
  await knex.schema.alterTable("decisions", (table) => {
    table.dropColumn("project_version");
  });
  await knex.schema.alterTable("items", (table) => {
    table.dropColumn("project_version");
  });
  await knex.schema.alterTable("skills", (table) => {
    table.dropColumn("project_version");
  });
  await knex.schema.alterTable("artifacts", (table) => {
    table.dropColumn("project_version");
  });
};
