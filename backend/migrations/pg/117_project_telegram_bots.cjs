exports.up = async function up(knex) {
  await knex.schema.createTable("project_telegram_bots", (t) => {
    t.uuid("id").primary();
    t.text("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    // A bot token must have only one logical update consumer.
    t.text("telegram_bot_id").notNullable().unique();
    t.text("username").notNullable();
    t.jsonb("filter_tags").notNullable();
    t.text("token_enc").notNullable();
    t.bigInteger("poll_offset").notNullable().defaultTo(0);
    t.uuid("poll_revision").notNullable();
    t.uuid("poll_owner");
    t.timestamp("poll_lease_until", { useTz: true });
    t.timestamp("poll_retry_at", { useTz: true });
    t.timestamp("last_polled_at", { useTz: true });
    t.text("poll_error");
    t.text("link_code_hash");
    t.timestamp("link_code_expires_at", { useTz: true });
    t.boolean("enabled").notNullable().defaultTo(false);
    t.text("last_error");
    t.text("last_chat_title");
    t.timestamp("last_received_at", { useTz: true });
    t.timestamp("created_at", { useTz: true }).notNullable();
    t.timestamp("updated_at", { useTz: true }).notNullable();
    t.index("project_id");
  });
  await knex.schema.createTable("project_telegram_chats", (t) => {
    t.uuid("bot_id").notNullable().references("id").inTable("project_telegram_bots").onDelete("CASCADE");
    t.text("chat_id").notNullable();
    t.text("title").notNullable();
    t.timestamp("created_at", { useTz: true }).notNullable();
    t.primary(["bot_id", "chat_id"]);
  });
  await knex.schema.createTable("telegram_message_inbox", (t) => {
    t.uuid("id").primary();
    t.uuid("bot_id").notNullable().references("id").inTable("project_telegram_bots").onDelete("CASCADE");
    t.text("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    t.text("chat_id").notNullable();
    t.text("message_id").notNullable();
    t.jsonb("payload").notNullable();
    t.jsonb("classification");
    t.text("classified_owner_id");
    t.text("status").notNullable().defaultTo("pending");
    t.integer("attempts").notNullable().defaultTo(0);
    t.timestamp("available_at", { useTz: true }).notNullable();
    t.timestamp("locked_until", { useTz: true });
    t.text("last_error");
    t.timestamp("received_at", { useTz: true }).notNullable();
    t.unique(["project_id", "chat_id", "message_id"]);
    t.index(["status", "available_at"]);
    t.check("status in ('pending', 'processing', 'done', 'ignored', 'failed')");
  });
  await knex.schema.createTable("telegram_task_sources", (t) => {
    t.text("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    t.text("chat_id").notNullable();
    t.text("message_id").notNullable();
    t.text("telegram_user_id").notNullable();
    t.text("task_id").references("id").inTable("tasks").onDelete("SET NULL");
    t.timestamp("created_at", { useTz: true }).notNullable();
    // Survives bot removal/reconnection and task deletion; two bots in the
    // same chat must not create two tasks for the same person/message.
    t.primary(["project_id", "chat_id", "message_id", "telegram_user_id"]);
  });
};
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("telegram_task_sources");
  await knex.schema.dropTableIfExists("telegram_message_inbox");
  await knex.schema.dropTableIfExists("project_telegram_chats");
  await knex.schema.dropTableIfExists("project_telegram_bots");
};
