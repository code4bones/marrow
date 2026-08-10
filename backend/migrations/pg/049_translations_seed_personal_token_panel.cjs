// PersonalTokenPanel (mirrors OAuthClientPanel's own translation keys,
// wording adjusted for "token" instead of "credential") -- personal_tokens
// moved from one-per-user to multi-token-per-user (048), replacing the old
// single shared-token Connect UI. Also splits ConnectedSummary's combined
// "Claude Code / Codex (CLI)" row into two independent rows, one per
// connection, matching how each now has its own token.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "profile", key: "couldNotLoadTokens", value: "Could not load your personal tokens.", updated_at: now },
    { locale: "ru", namespace: "profile", key: "couldNotLoadTokens", value: "Не удалось загрузить ваши персональные токены.", updated_at: now },
    { locale: "en", namespace: "profile", key: "couldNotCreateToken", value: "Could not create a personal token.", updated_at: now },
    { locale: "ru", namespace: "profile", key: "couldNotCreateToken", value: "Не удалось создать персональный токен.", updated_at: now },
    { locale: "en", namespace: "profile", key: "couldNotRegenerateToken", value: "Could not regenerate this personal token.", updated_at: now },
    { locale: "ru", namespace: "profile", key: "couldNotRegenerateToken", value: "Не удалось перевыпустить этот токен.", updated_at: now },
    { locale: "en", namespace: "profile", key: "couldNotDeleteToken", value: "Could not delete this personal token.", updated_at: now },
    { locale: "ru", namespace: "profile", key: "couldNotDeleteToken", value: "Не удалось удалить этот токен.", updated_at: now },
    { locale: "en", namespace: "profile", key: "untitledToken", value: "Untitled token", updated_at: now },
    { locale: "ru", namespace: "profile", key: "untitledToken", value: "Без названия", updated_at: now },
    { locale: "en", namespace: "profile", key: "deleteTokenConfirmTitle", value: "Delete this token?", updated_at: now },
    { locale: "ru", namespace: "profile", key: "deleteTokenConfirmTitle", value: "Удалить этот токен?", updated_at: now },
    { locale: "en", namespace: "profile", key: "deleteTokenDescription", value: "This token stops working immediately. It has no effect on your other tokens.", updated_at: now },
    { locale: "ru", namespace: "profile", key: "deleteTokenDescription", value: "Этот токен сразу перестанет работать. Это не затронет остальные ваши токены.", updated_at: now },
    { locale: "en", namespace: "profile", key: "createToken", value: "Create token", updated_at: now },
    { locale: "ru", namespace: "profile", key: "createToken", value: "Создать токен", updated_at: now },
    { locale: "en", namespace: "profile", key: "addAnotherToken", value: "Add another token", updated_at: now },
    { locale: "ru", namespace: "profile", key: "addAnotherToken", value: "Добавить ещё один токен", updated_at: now },
    { locale: "en", namespace: "profile", key: "claudeCliConnectionName", value: "Claude Code (CLI)", updated_at: now },
    { locale: "ru", namespace: "profile", key: "claudeCliConnectionName", value: "Claude Code (CLI)", updated_at: now },
    { locale: "en", namespace: "profile", key: "codexCliConnectionName", value: "Codex (CLI)", updated_at: now },
    { locale: "ru", namespace: "profile", key: "codexCliConnectionName", value: "Codex (CLI)", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "profile" })
    .whereIn("key", [
      "couldNotLoadTokens",
      "couldNotCreateToken",
      "couldNotRegenerateToken",
      "couldNotDeleteToken",
      "untitledToken",
      "deleteTokenConfirmTitle",
      "deleteTokenDescription",
      "createToken",
      "addAnotherToken",
      "claudeCliConnectionName",
      "codexCliConnectionName"
    ])
    .delete();
};
