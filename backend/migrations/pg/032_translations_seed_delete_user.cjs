// Admin Users screen only had disable/enable -- no way to actually remove a
// throwaway/test account short of a direct DB write. users.id has ON DELETE
// CASCADE/SET NULL on every dependent table already, so a real delete is
// safe; this just seeds the UI strings for it.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    users: {
      delete: { en: "Delete", ru: "Удалить" },
      deleteAccountConfirm: { en: "Permanently delete this account?", ru: "Удалить этот аккаунт навсегда?" },
      deleteAccountWarning: {
        en: "This cannot be undone. Their sessions, tokens, and project memberships are removed immediately.",
        ru: "Это необратимо. Их сессии, токены и участие в проектах будут удалены немедленно."
      },
      couldNotDeleteUser: { en: "Could not delete this user.", ru: "Не удалось удалить пользователя." },
      userDeleted: { en: "User deleted.", ru: "Пользователь удалён." }
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
  await knex("translations")
    .where({ namespace: "users" })
    .whereIn("key", ["delete", "deleteAccountConfirm", "deleteAccountWarning", "couldNotDeleteUser", "userDeleted"])
    .delete();
};
