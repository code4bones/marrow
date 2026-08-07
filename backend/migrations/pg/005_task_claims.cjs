const claimStatuses = ["active", "released", "completed", "expired", "cancelled"];
const claimRoles = ["backend", "frontend", "test", "docs", "review", "devops", "coordination", "other"];

exports.up = async function up(knex) {
  await knex.schema.createTable("task_claims", (table) => {
    table.text("id").primary();
    table.text("task_id").notNullable().references("id").inTable("tasks").onDelete("CASCADE");
    table.text("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    table.text("client_id").notNullable();
    table.text("client_label");
    table.text("client_kind");
    table.text("role").notNullable().defaultTo("other");
    table.text("scope");
    table.text("status").notNullable().defaultTo("active");
    table.timestamp("lease_expires_at", { useTz: true }).notNullable();
    table.timestamp("heartbeat_at", { useTz: true }).notNullable();
    table.text("note");
    table.text("created_by");
    table.text("updated_by");
    table.text("source_instance_id");
    table.integer("version").notNullable().defaultTo(1);
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.check("status in (" + claimStatuses.map(() => "?").join(", ") + ")", claimStatuses);
    table.check("role in (" + claimRoles.map(() => "?").join(", ") + ")", claimRoles);
  });

  await knex.schema.raw("create index idx_task_claims_task_id on task_claims(task_id)");
  await knex.schema.raw("create index idx_task_claims_project_id on task_claims(project_id)");
  await knex.schema.raw("create index idx_task_claims_status on task_claims(status)");
  await knex.schema.raw("create index idx_task_claims_lease_expires_at on task_claims(lease_expires_at)");
  await knex.schema.raw("create index idx_task_claims_client_id on task_claims(client_id)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("task_claims");
};
