// Ask Marrow: named, multiple conversations per user (owner's request,
// 2026-09-14, a follow-up once the single-thread v1 was already live and
// tested: "забыли про New Chat & Chat List (+ delete chat), перед
// созданием нового чата нужно ввести его название"). Was one continuous
// thread per user (ai_chat_messages.user_id directly); now messages belong
// to a titled ai_conversations row instead, and a user can have many.
//
// Data safety: the owner had already live-tested ai.ask against production
// before this migration was written, so ai_chat_messages may already have
// real rows. Rather than dropping that history, every distinct user_id
// currently in ai_chat_messages gets exactly one backfilled conversation
// (title "Chat", created_at = that user's earliest message) and all of
// that user's existing messages are re-pointed at it via conversation_id
// before the column is made NOT NULL and user_id is dropped.
const { randomUUID } = require("node:crypto");

exports.up = async function up(knex) {
  await knex.schema.createTable("ai_conversations", (table) => {
    table.text("id").primary();
    table.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("title").notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
  });
  await knex.schema.raw("create index idx_ai_conversations_user_updated on ai_conversations(user_id, updated_at desc)");

  await knex.schema.alterTable("ai_chat_messages", (table) => {
    table.text("conversation_id").references("id").inTable("ai_conversations").onDelete("CASCADE");
  });

  const existingUserIds = await knex("ai_chat_messages").distinct("user_id").pluck("user_id");
  for (const userId of existingUserIds) {
    const earliest = await knex("ai_chat_messages").where({ user_id: userId }).min({ created_at: "created_at" }).first();
    const now = new Date().toISOString();
    const conversationId = randomUUID();
    await knex("ai_conversations").insert({
      id: conversationId,
      user_id: userId,
      title: "Chat",
      created_at: earliest?.created_at ?? now,
      updated_at: now
    });
    await knex("ai_chat_messages").where({ user_id: userId }).update({ conversation_id: conversationId });
  }

  await knex.schema.alterTable("ai_chat_messages", (table) => {
    table.text("conversation_id").notNullable().alter();
    table.dropColumn("user_id");
  });
  await knex.schema.raw("create index idx_ai_chat_messages_conversation_created on ai_chat_messages(conversation_id, created_at)");
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("ai_chat_messages", (table) => {
    table.text("user_id").references("id").inTable("users").onDelete("CASCADE");
  });
  const rows = await knex("ai_chat_messages as m")
    .join("ai_conversations as c", "c.id", "m.conversation_id")
    .select("m.id as message_id", "c.user_id as user_id");
  for (const row of rows) {
    await knex("ai_chat_messages").where({ id: row.message_id }).update({ user_id: row.user_id });
  }
  await knex.schema.alterTable("ai_chat_messages", (table) => {
    table.text("user_id").notNullable().alter();
    table.dropColumn("conversation_id");
  });
  await knex.schema.raw("create index idx_ai_chat_messages_user_created on ai_chat_messages(user_id, created_at)");
  await knex.schema.dropTableIfExists("ai_conversations");
};
