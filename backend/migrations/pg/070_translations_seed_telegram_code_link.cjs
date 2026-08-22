// T-MEMORY-101: i18n for the code-based Telegram linking fallback (some
// countries block oauth.telegram.org outright) and the "open the bot"
// link -- same shape as 064_translations_seed_telegram.cjs.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    profile: {
      openTelegramBot: { en: "Open bot", ru: "Открыть бота" },
      telegramCodeIntro: {
        en: "OAuth sign-in blocked in your country? Get a code and send it to the bot instead.",
        ru: "OAuth не работает в вашей стране? Получите код и отправьте его боту."
      },
      getTelegramCode: { en: "Get code", ru: "Получить код" },
      telegramCodeHint: {
        en: "Send this code as a plain message to {{bot}} within {{minutes}} minutes:",
        ru: "Отправьте этот код обычным сообщением боту {{bot}} в течение {{minutes}} минут:"
      },
      telegramCodeExpired: { en: "Code expired — request a new one.", ru: "Код истёк — запросите новый." },
      couldNotGetTelegramCode: { en: "Could not generate a code.", ru: "Не удалось получить код." }
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
};

exports.down = async function down(knex) {
  const keys = [
    ["profile", "openTelegramBot"],
    ["profile", "telegramCodeIntro"],
    ["profile", "getTelegramCode"],
    ["profile", "telegramCodeHint"],
    ["profile", "telegramCodeExpired"],
    ["profile", "couldNotGetTelegramCode"]
  ];
  for (const [namespace, key] of keys) {
    await knex("translations").where({ namespace, key }).delete();
  }
};
