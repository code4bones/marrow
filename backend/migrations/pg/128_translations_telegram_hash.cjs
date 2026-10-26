const entries = {
  botRecipientMappingConflict: { en: "Choose one member to resolve conflicting mappings", ru: "Выберите участника, чтобы объединить разные привязки" },
  botMessageStatus_command: { en: "Command", ru: "Команда" },
  botMessageReason_hash_command: { en: "/hash: tag list requested", ru: "/hash: запрошен список тегов" },
  botMessageReason_command_other_bot: { en: "Command addressed to another bot", ru: "Команда адресована другому боту" }
};
exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) => Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "projects", key, value, updated_at })));
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};
exports.down = async function down(knex) { await knex("translations").where({ namespace: "projects" }).whereIn("key", Object.keys(entries)).del(); };
