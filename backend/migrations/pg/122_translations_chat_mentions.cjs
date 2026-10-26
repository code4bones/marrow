const entries = {
  botsSetupHelpWithMappings: { en: "Add dedicated bots, choose their hashtags and link each group/channel with a single-use key. Map observed @mentions to project members in each chat's settings. Only tagged messages with mentions in bound chats reach the owner's DeepSeek. One source message creates at most one task; multiple or unresolved recipients fall back to the project owner. The bot replies with the task link after saving it. In groups, make the bot an admin or disable Privacy Mode and re-add it; in channels, add it as an admin.", ru: "Добавьте отдельных ботов, настройте теги и привяжите каждую группу или канал одноразовым ключом. В настройках группы сопоставьте найденные @упоминания с участниками проекта. В DeepSeek владельца уходят только сообщения из привязанных чатов с подходящим тегом и упоминаниями. Из одного сообщения создаётся максимум одна задача; при нескольких или неопределённых адресатах исполнитель — владелец проекта. После сохранения бот ответит ссылкой на задачу. В группе назначьте бота администратором либо отключите Privacy Mode и добавьте заново; в канале добавьте администратором." },
  botChatSettings: { en: "Recipients", ru: "Адресаты" },
  botChatSettingsTitle: { en: "Recipients: {{title}}", ru: "Адресаты: {{title}}" },
  botChatMappingHelp: { en: "Mentions from new messages in this bound chat appear here even when tags do not match. A manual mapping takes priority over a linked Telegram account and applies only to this bot and chat. Clearing it restores account matching. If no active member can be identified, or a message has several distinct mentions, the project owner is assigned. Changes apply to future tasks and queued messages, without reprocessing old messages.", ru: "Здесь появляются упоминания из новых сообщений этой группы, даже если теги не подошли. Ручное сопоставление имеет приоритет над привязанным Telegram-аккаунтом и действует только для этого бота и группы. После снятия используется сопоставление по аккаунту. Если активный участник не определён или в сообщении несколько разных упоминаний, задача назначается владельцу проекта. Изменения применяются к будущим задачам и сообщениям в очереди; старые сообщения повторно не обрабатываются." },
  botNoMentions: { en: "No mentions observed in this chat yet", ru: "Упоминаний в этой группе пока не найдено" },
  botObservedMention: { en: "Telegram mention", ru: "Упоминание в Telegram" },
  botManualRecipient: { en: "Manual mapping", ru: "Ручное сопоставление" },
  botEffectiveRecipient: { en: "Recipient for a single mention", ru: "Исполнитель при одном упоминании" },
  botSelectMember: { en: "Select a project member", ru: "Выберите участника проекта" },
  botMapMentionLabel: { en: "Map {{mention}} to a project member", ru: "Сопоставить {{mention}} с участником проекта" },
  botClearMapping: { en: "Clear", ru: "Снять привязку" },
  botMentionLastSeen: { en: "Last seen", ru: "Последнее упоминание" },
  botMentionResolution_manual: { en: "Manual mapping", ru: "Назначен вручную" },
  botMentionResolution_linked: { en: "Linked Telegram account", ru: "Привязанный Telegram-аккаунт" },
  botMentionResolution_owner: { en: "Fallback: project owner", ru: "По умолчанию: владелец проекта" }
};
exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) => Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "projects", key, value, updated_at })));
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};
exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "projects" }).whereIn("key", Object.keys(entries)).del();
};
