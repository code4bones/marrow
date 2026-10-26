exports.up = async function up(knex) {
  await knex.schema.createTable("telegram_outgoing_messages", (t) => {
    t.uuid("id").primary();
    t.uuid("bot_id").references("id").inTable("project_telegram_bots").onDelete("SET NULL");
    t.text("chat_id").notNullable(); t.text("message_id");
    t.text("fingerprint").notNullable();
    t.timestamp("created_at", { useTz: true }).notNullable();
    // Shared by every project bot: another bot must not classify our reply.
    t.index(["chat_id", "message_id"]);
    t.index(["chat_id", "fingerprint", "created_at"]);
  });
};
exports.down = async function down(knex) { await knex.schema.dropTableIfExists("telegram_outgoing_messages"); };
