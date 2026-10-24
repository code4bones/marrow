exports.up = async function up(knex) {
  await knex.schema.createTable("project_repositories", (table) => {
    table.uuid("id").primary();
    table.text("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    table.text("host").notNullable();
    table.text("gitlab_project_id").notNullable();
    table.text("path").notNullable();
    table.text("name").notNullable();
    table.text("web_url").notNullable();
    table.text("created_by").notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.unique(["project_id", "host", "gitlab_project_id"], "project_repositories_unique");
  });
  await knex.schema.createTable("project_gitlab_members", (table) => {
    table.text("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    table.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("host").notNullable();
    table.text("gitlab_user_id").notNullable();
    table.text("username").notNullable();
    table.text("name").notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.primary(["project_id", "user_id", "host"]);
    table.unique(["project_id", "host", "gitlab_user_id"], "project_gitlab_members_external_unique");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("project_gitlab_members");
  await knex.schema.dropTableIfExists("project_repositories");
};
