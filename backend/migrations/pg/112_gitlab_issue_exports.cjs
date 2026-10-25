exports.up = async function up(knex) {
  await knex.schema.createTable("gitlab_issue_exports", (t) => {
    t.uuid("id").primary();
    t.text("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    t.text("task_id").unique().references("id").inTable("tasks").onDelete("SET NULL");
    // Survives deletion so an early/late webhook cannot recreate the task.
    t.text("source_task_id").notNullable();
    t.uuid("repository_id").references("id").inTable("project_repositories").onDelete("SET NULL");
    t.boolean("repository_explicit").notNullable().defaultTo(false);
    t.text("host");
    t.text("gitlab_project_id");
    t.text("repository_url");
    t.text("actor_user_id").notNullable();
    t.text("recipient_user_id").notNullable();
    t.text("gitlab_user_id");
    t.text("status").notNullable();
    t.text("last_error");
    t.text("issue_id");
    t.text("issue_iid");
    t.timestamp("post_attempted_at", { useTz: true });
    t.timestamp("available_at", { useTz: true }).notNullable();
    t.timestamp("locked_until", { useTz: true });
    t.integer("attempts").notNullable().defaultTo(0);
    t.timestamp("created_at", { useTz: true }).notNullable();
    t.timestamp("updated_at", { useTz: true }).notNullable();
    t.index(["status", "available_at"]);
    t.check("status in ('pending', 'processing', 'uncertain', 'blocked', 'failed', 'done', 'cancelled')");
  });
};
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("gitlab_issue_exports");
};
