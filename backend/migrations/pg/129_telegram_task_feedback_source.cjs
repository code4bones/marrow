exports.up = async function up(knex) {
  await knex.schema.alterTable("telegram_task_sources", (t) => {
    t.uuid("bot_id").references("id").inTable("project_telegram_bots").onDelete("SET NULL");
    t.bigInteger("message_thread_id");
    t.jsonb("participants").notNullable().defaultTo("{}");
    t.index("task_id");
  });
  const sources = await knex("telegram_task_sources as s").join("telegram_message_inbox as i", function () {
    this.on("i.project_id", "s.project_id").andOn("i.chat_id", "s.chat_id").andOn("i.message_id", "s.message_id");
  }).select("s.project_id", "s.chat_id", "s.message_id", "s.telegram_user_id", "i.bot_id", "i.payload");
  for (const s of sources) {
    const payload = typeof s.payload === "string" ? JSON.parse(s.payload) : s.payload;
    const thread = payload?.messageThreadId;
    await knex("telegram_task_sources").where({ project_id: s.project_id, chat_id: s.chat_id, message_id: s.message_id, telegram_user_id: s.telegram_user_id })
      .update({ bot_id: s.bot_id, message_thread_id: Number.isSafeInteger(thread) && thread > 0 ? thread : null });
  }
};
exports.down = async function down(knex) {
  await knex.schema.alterTable("telegram_task_sources", (t) => { t.dropIndex("task_id"); t.dropColumn("bot_id"); t.dropColumn("message_thread_id"); t.dropColumn("participants"); });
};
