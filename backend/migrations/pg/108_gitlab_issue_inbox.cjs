exports.up = async function up(knex) {
  await knex.schema.createTable("gitlab_webhooks", (t) => {
    t.uuid("repository_id").primary().references("id").inTable("project_repositories").onDelete("CASCADE");
    t.text("hook_id");
    t.text("auth_mode").notNullable();
    t.text("secret_enc").notNullable();
    t.boolean("enabled").notNullable().defaultTo(false);
    t.text("last_error");
    t.timestamp("updated_at", { useTz: true }).notNullable();
  });
  await knex.schema.createTable("gitlab_issue_links", (t) => {
    t.text("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    t.text("host").notNullable();
    t.text("gitlab_project_id").notNullable();
    t.text("issue_id").notNullable();
    t.text("issue_iid").notNullable();
    t.text("task_id").references("id").inTable("tasks").onDelete("SET NULL");
    t.timestamp("created_at", { useTz: true }).notNullable();
    t.primary(["project_id", "host", "gitlab_project_id", "issue_id"]);
  });
  await knex.schema.createTable("gitlab_issue_inbox", (t) => {
    t.uuid("id").primary();
    t.uuid("repository_id").notNullable().references("id").inTable("project_repositories").onDelete("CASCADE");
    t.text("delivery_key").notNullable();
    t.jsonb("payload").notNullable();
    t.text("status").notNullable().defaultTo("pending");
    t.integer("attempts").notNullable().defaultTo(0);
    t.timestamp("available_at", { useTz: true }).notNullable();
    t.timestamp("locked_until", { useTz: true });
    t.text("last_error");
    t.text("task_id").references("id").inTable("tasks").onDelete("SET NULL");
    t.timestamp("received_at", { useTz: true }).notNullable();
    t.timestamp("processed_at", { useTz: true });
    t.unique(["repository_id", "delivery_key"]);
    t.index(["status", "available_at"]);
    t.check("status in ('pending', 'processing', 'done', 'ignored', 'failed')");
  });
};
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("gitlab_issue_inbox");
  await knex.schema.dropTableIfExists("gitlab_issue_links");
  await knex.schema.dropTableIfExists("gitlab_webhooks");
};
