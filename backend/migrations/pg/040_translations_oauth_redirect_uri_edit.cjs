// Adds ability to fix a credential's redirect_uri in place instead of
// forcing delete+recreate (see OAuthClientPanel.tsx's inline edit affordance).
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    profile: {
      editRedirectUri: { en: "Edit redirect URI", ru: "Изменить redirect URI" },
      redirectUriNotSet: { en: "Not set", ru: "Не задан" },
      couldNotUpdateRedirectUri: {
        en: "Could not update this credential’s redirect URI.",
        ru: "Не удалось обновить redirect URI для этих учётных данных."
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
  await knex("translations")
    .where({ namespace: "profile" })
    .whereIn("key", ["editRedirectUri", "redirectUriNotSet", "couldNotUpdateRedirectUri"])
    .delete();
};
