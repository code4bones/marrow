exports.up = async function up(knex) {
  await knex.schema.alterTable("project_telegram_bots", (t) => {
    t.bigInteger("received_count").notNullable().defaultTo(0);
    t.bigInteger("matched_count").notNullable().defaultTo(0);
    t.bigInteger("processed_count").notNullable().defaultTo(0);
    t.timestamp("last_matched_at", { useTz: true });
    t.timestamp("last_processed_at", { useTz: true });
  });
  await knex.schema.alterTable("telegram_message_inbox", (t) => {
    t.timestamp("classified_at", { useTz: true });
    t.timestamp("processed_at", { useTz: true });
    t.text("result_reason");
  });
  await knex.schema.createTable("telegram_bot_messages", (t) => {
    t.uuid("id").primary();
    t.uuid("bot_id").notNullable().references("id").inTable("project_telegram_bots").onDelete("CASCADE");
    t.bigInteger("telegram_update_id").notNullable();
    t.text("chat_id");
    t.text("chat_title");
    t.text("chat_type").notNullable();
    t.text("message_id");
    t.text("message_kind").notNullable();
    t.text("text");
    t.text("message_url");
    t.text("status").notNullable();
    t.text("reason");
    t.jsonb("matched_tags").notNullable();
    t.jsonb("mentions").notNullable();
    t.uuid("inbox_id").references("id").inTable("telegram_message_inbox").onDelete("SET NULL");
    t.timestamp("received_at", { useTz: true }).notNullable();
    t.unique(["bot_id", "telegram_update_id"]);
    t.index(["bot_id", "received_at"]);
  });
};
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("telegram_bot_messages");
  await knex.schema.alterTable("telegram_message_inbox", (t) => {
    t.dropColumn("classified_at"); t.dropColumn("processed_at"); t.dropColumn("result_reason");
  });
  await knex.schema.alterTable("project_telegram_bots", (t) => {
    t.dropColumn("received_count"); t.dropColumn("matched_count"); t.dropColumn("processed_count");
    t.dropColumn("last_matched_at"); t.dropColumn("last_processed_at");
  });
};
