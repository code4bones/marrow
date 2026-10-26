exports.up = async function up(knex) {
  await knex.schema.createTable("telegram_chat_mentions", (t) => {
    t.uuid("bot_id").notNullable();
    t.text("chat_id").notNullable();
    t.text("mention_key").notNullable();
    t.text("label").notNullable();
    t.text("user_id").references("id").inTable("users").onDelete("SET NULL");
    t.timestamp("last_seen_at", { useTz: true }).notNullable();
    t.primary(["bot_id", "chat_id", "mention_key"]);
    t.foreign(["bot_id", "chat_id"]).references(["bot_id", "chat_id"]).inTable("project_telegram_chats").onDelete("CASCADE");
  });
};
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("telegram_chat_mentions");
};
