exports.up = async function up(knex) {
  await knex.schema.alterTable("telegram_outgoing_messages", (t) => t.text("task_id").references("id").inTable("tasks").onDelete("SET NULL"));
  await knex.schema.createTable("telegram_media_groups", (t) => {
    t.text("project_id").references("id").inTable("projects").onDelete("CASCADE");
    t.text("chat_id"); t.text("media_group_id"); t.text("message_id").notNullable();
    t.primary(["project_id", "chat_id", "media_group_id"]);
  });
  await knex.schema.createTable("telegram_message_files", (t) => {
    t.uuid("id").primary();
    t.text("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    t.uuid("bot_id").references("id").inTable("project_telegram_bots").onDelete("SET NULL");
    for (const key of ["chat_id", "message_id", "file_id", "file_unique_id", "kind", "file_name", "content_type"]) t.text(key).notNullable();
    t.text("media_group_id"); t.text("reply_to_message_id"); t.bigInteger("message_thread_id"); t.bigInteger("size_bytes");
    t.text("task_id").references("id").inTable("tasks").onDelete("SET NULL");
    t.text("artifact_id").references("id").inTable("artifacts").onDelete("SET NULL");
    t.text("status").notNullable().defaultTo("waiting"); t.integer("attempts").notNullable().defaultTo(0);
    t.timestamp("available_at", { useTz: true }).notNullable(); t.timestamp("received_at", { useTz: true }).notNullable();
    t.timestamp("locked_until", { useTz: true }); t.text("last_error");
    t.unique(["project_id", "chat_id", "message_id", "file_unique_id"]);
    t.index(["status", "available_at"]); t.index(["project_id", "chat_id", "media_group_id"]); t.index("task_id");
    t.check("status in ('waiting','pending','processing','done','failed')");
  });
};
exports.down = async function down(knex) { await knex.schema.dropTable("telegram_message_files"); await knex.schema.dropTable("telegram_media_groups"); await knex.schema.alterTable("telegram_outgoing_messages", (t) => t.dropColumn("task_id")); };
