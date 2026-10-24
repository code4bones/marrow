exports.up = async function up(knex) {
  await knex.schema.alterTable("project_repositories", (table) => {
    table.text("lead_user_id").nullable().references("id").inTable("users").onDelete("SET NULL");
  });
};
exports.down = async function down(knex) {
  await knex.schema.alterTable("project_repositories", (table) => table.dropColumn("lead_user_id"));
};
