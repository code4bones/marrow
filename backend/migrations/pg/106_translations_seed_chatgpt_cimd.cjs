// ChatGPT moved from a user-created OAuth client secret to the server's
// verified CIMD public-client flow. This must be a new migration: 020 has
// already been applied in deployed databases.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    cimd: { en: "CIMD", ru: "CIMD" },
    chatgptCimdInfo: {
      en: "ChatGPT uses secure CIMD + PKCE automatically. Do not create or paste a Client ID or Client Secret — click Connect and sign in to Marrow when prompted.",
      ru: "ChatGPT автоматически использует безопасные CIMD + PKCE. Не создавайте и не вставляйте Client ID или Client Secret — нажмите Connect и войдите в Marrow по запросу."
    }
  };

  const rows = Object.entries(entries).flatMap(([key, locales]) =>
    Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "profile", key, value, updated_at: now }))
  );
  await knex("translations").insert(rows);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "profile" }).whereIn("key", ["cimd", "chatgptCimdInfo"]).delete();
};
