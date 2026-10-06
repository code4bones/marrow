// Sidebar version line now links out to the Telegram bot (icon only, no
// bot username shown) when TELEGRAM_BOT_TOKEN/TELEGRAM_BOT_NAME is set --
// see widgets/navigation-rail/index.tsx's VersionLine. T-MEMORY-179.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "nav", key: "openTelegramBot", value: "Open our Telegram bot", updated_at: now },
    { locale: "ru", namespace: "nav", key: "openTelegramBot", value: "Открыть Telegram-бота", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "nav", key: "openTelegramBot" }).delete();
};
