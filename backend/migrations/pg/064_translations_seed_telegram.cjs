// i18n for Telegram sign-in (login screen widget) and the profile page's
// Telegram link/unlink section -- same shape as
// 027_translations_seed_github_oauth.cjs.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    auth: {
      signInWithTelegram: { en: "Sign in with Telegram", ru: "Войти через Telegram" }
    },
    profile: {
      telegramConnectedAs: { en: "Connected to Telegram as @{{username}}", ru: "Подключён к Telegram как @{{username}}" },
      telegramConnected: { en: "Connected to Telegram", ru: "Telegram подключён" },
      telegramNotConnected: { en: "Not connected to Telegram", ru: "Telegram не подключён" },
      unlinkTelegram: { en: "Unlink", ru: "Отвязать" },
      unlinkTelegramConfirmTitle: { en: "Unlink your Telegram account?", ru: "Отвязать аккаунт Telegram?" },
      unlinkTelegramDescription: { en: "You can connect it again anytime.", ru: "Вы всегда сможете подключить его снова." },
      telegramLinked: { en: "Telegram account linked.", ru: "Аккаунт Telegram подключён." },
      telegramUnlinked: { en: "Telegram account unlinked.", ru: "Аккаунт Telegram отвязан." },
      couldNotLoadTelegramStatus: { en: "Could not load Telegram connection status.", ru: "Не удалось загрузить статус подключения Telegram." },
      couldNotUnlinkTelegram: { en: "Could not unlink Telegram.", ru: "Не удалось отвязать Telegram." },
      pressStartHint: {
        en: "Almost done — open {{bot}} in Telegram and press Start so it can actually message you.",
        ru: "Почти готово — откройте {{bot}} в Telegram и нажмите Start, чтобы бот мог вам писать."
      }
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
    ["auth", "signInWithTelegram"],
    ["profile", "telegramConnectedAs"],
    ["profile", "telegramConnected"],
    ["profile", "telegramNotConnected"],
    ["profile", "unlinkTelegram"],
    ["profile", "unlinkTelegramConfirmTitle"],
    ["profile", "unlinkTelegramDescription"],
    ["profile", "telegramLinked"],
    ["profile", "telegramUnlinked"],
    ["profile", "couldNotLoadTelegramStatus"],
    ["profile", "couldNotUnlinkTelegram"],
    ["profile", "pressStartHint"]
  ];
  for (const [namespace, key] of keys) {
    await knex("translations").where({ namespace, key }).delete();
  }
};
