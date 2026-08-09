// T-MEMORY-059: the OAuth consent screen now shows the redirect host the
// authorization code will actually be sent to, alongside the connector's
// recognizable name (owner: whitebox pentest finding #4, I-MEMORY-055).
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    auth: {
      redirectsTo: { en: "Redirects to {{host}} after you decide.", ru: "После решения перенаправит на {{host}}." }
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
  await knex("translations").where({ namespace: "auth", key: "redirectsTo" }).delete();
};
