// T-MEMORY-084: strings for the new "Admin" tab on the Profile page --
// a single global on/off switch for the whole credits economy.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "profile", key: "admin", value: "Admin", updated_at: now },
    { locale: "ru", namespace: "profile", key: "admin", value: "Админ", updated_at: now },
    { locale: "en", namespace: "profile", key: "creditsEconomy", value: "Credits economy", updated_at: now },
    { locale: "ru", namespace: "profile", key: "creditsEconomy", value: "Экономика кредитов", updated_at: now },
    {
      locale: "en",
      namespace: "profile",
      key: "creditsEconomyDescription",
      value: "Turns the whole credits/wallet/streak game mechanic on or off for everyone. While off, no credits are earned, lost, or spent -- existing balances and history are kept untouched.",
      updated_at: now
    },
    {
      locale: "ru",
      namespace: "profile",
      key: "creditsEconomyDescription",
      value: "Включает или выключает всю игровую механику кредитов/кошелька/серий для всех пользователей. Пока выключено, кредиты не начисляются, не списываются и не тратятся -- существующие балансы и история сохраняются без изменений.",
      updated_at: now
    },
    { locale: "en", namespace: "profile", key: "creditsEnabledOn", value: "On", updated_at: now },
    { locale: "ru", namespace: "profile", key: "creditsEnabledOn", value: "Вкл", updated_at: now },
    { locale: "en", namespace: "profile", key: "creditsEnabledOff", value: "Off", updated_at: now },
    { locale: "ru", namespace: "profile", key: "creditsEnabledOff", value: "Выкл", updated_at: now },
    { locale: "en", namespace: "profile", key: "creditsEnabledHint", value: "Credits are active for everyone.", updated_at: now },
    { locale: "ru", namespace: "profile", key: "creditsEnabledHint", value: "Кредиты активны для всех пользователей.", updated_at: now },
    { locale: "en", namespace: "profile", key: "creditsDisabledHint", value: "Credits are paused -- no awards, penalties, or spending until re-enabled.", updated_at: now },
    { locale: "ru", namespace: "profile", key: "creditsDisabledHint", value: "Кредиты приостановлены -- начисления, штрафы и траты недоступны до повторного включения.", updated_at: now },
    { locale: "en", namespace: "profile", key: "creditsSettingsUpdated", value: "Credits settings updated.", updated_at: now },
    { locale: "ru", namespace: "profile", key: "creditsSettingsUpdated", value: "Настройки кредитов обновлены.", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "profile" })
    .whereIn("key", [
      "admin",
      "creditsEconomy",
      "creditsEconomyDescription",
      "creditsEnabledOn",
      "creditsEnabledOff",
      "creditsEnabledHint",
      "creditsDisabledHint",
      "creditsSettingsUpdated"
    ])
    .delete();
};
