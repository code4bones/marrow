// i18n seed for the multi-conversation follow-up to Ask Marrow
// (097_ai_chat_conversations.cjs) -- New Chat / Chat List / rename /
// delete chat. Also removes the three "ask" namespace keys the old
// single-thread "Clear conversation" action used (clearConfirmTitle,
// clear, cleared) -- superseded entirely by per-conversation delete, no
// UI references them anymore.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    ask: {
      newChat: { en: "New chat", ru: "Новый чат" },
      noChatsYet: { en: "No chats yet", ru: "Пока нет чатов" },
      renameChat: { en: "Rename chat", ru: "Переименовать чат" },
      chatTitlePlaceholder: { en: "Chat name", ru: "Название чата" },
      deleteChatConfirmTitle: { en: "Delete \"{{title}}\"?", ru: "Удалить «{{title}}»?" },
      delete: { en: "Delete", ru: "Удалить" },
      selectOrCreateChat: { en: "Select a chat, or start a new one", ru: "Выберите чат или начните новый" }
    }
  };

  const rows = [];
  for (const [namespace, keys] of Object.entries(entries)) {
    for (const [key, byLocale] of Object.entries(keys)) {
      for (const [locale, value] of Object.entries(byLocale)) {
        rows.push({ locale, namespace, key, value, updated_at: now });
      }
    }
  }

  await knex("translations").insert(rows);
  await knex("translations").where({ namespace: "ask" }).whereIn("key", ["clearConfirmTitle", "clear", "cleared"]).delete();
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "ask" })
    .whereIn("key", ["newChat", "noChatsYet", "renameChat", "chatTitlePlaceholder", "deleteChatConfirmTitle", "delete", "selectOrCreateChat"])
    .delete();

  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "ask", key: "clearConfirmTitle", value: "Clear this conversation?", updated_at: now },
    { locale: "ru", namespace: "ask", key: "clearConfirmTitle", value: "Очистить эту переписку?", updated_at: now },
    { locale: "en", namespace: "ask", key: "clear", value: "Clear conversation", updated_at: now },
    { locale: "ru", namespace: "ask", key: "clear", value: "Очистить переписку", updated_at: now },
    { locale: "en", namespace: "ask", key: "cleared", value: "Conversation cleared", updated_at: now },
    { locale: "ru", namespace: "ask", key: "cleared", value: "Переписка очищена", updated_at: now }
  ]);
};
