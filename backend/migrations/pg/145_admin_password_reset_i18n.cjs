const entries = {
  resetPassword: { en: "Reset password", ru: "Сбросить пароль" },
  resetPasswordConfirm: { en: "Create a password reset link for {{email}}?", ru: "Создать ссылку для сброса пароля {{email}}?" },
  resetPasswordWarning: {
    en: "Previous reset links will stop working. The password changes only when the user follows the new link.",
    ru: "Предыдущие ссылки для сброса перестанут работать. Пароль изменится, когда пользователь воспользуется новой ссылкой."
  },
  couldNotResetPassword: { en: "Could not create a password reset link.", ru: "Не удалось создать ссылку для сброса пароля." },
  passwordResetLink: { en: "Password reset link", ru: "Ссылка для сброса пароля" },
  resetLinkFor: { en: "Send this link to {{email}}.", ru: "Передайте эту ссылку пользователю {{email}}." },
  resetLinkShownOnce: {
    en: "Copy the link before closing this window. It grants access to change the password and is shown only once.",
    ru: "Скопируйте ссылку перед закрытием окна. Она даёт право изменить пароль и показывается только один раз."
  },
  resetLinkExpires: { en: "Valid until:", ru: "Действует до:" },
  resetLinkInstructions: {
    en: "The link is valid for 24 hours and can be used once. After the password changes, all browser sessions end. Two-factor authentication remains enabled if configured.",
    ru: "Ссылка действует 24 часа и используется один раз. После смены пароля все сессии в браузерах завершатся. Настройки двухфакторной аутентификации сохранятся."
  },
  closeResetLink: { en: "Close", ru: "Закрыть" }
};

exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) =>
    Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "users", key, value, updated_at }))
  );
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "users" }).whereIn("key", Object.keys(entries)).del();
};
