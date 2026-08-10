// PersonalTokenPanel/OAuthClientPanel now show a quick "used or not" marker
// next to each credential/token's created/last-used line, instead of just a
// bare (possibly empty) lastUsedAt timestamp -- owner: easier to scan which
// credentials are actually live vs. safe to clean up.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "profile", key: "activeMarker", value: "Active", updated_at: now },
    { locale: "ru", namespace: "profile", key: "activeMarker", value: "Активен", updated_at: now },
    { locale: "en", namespace: "profile", key: "neverUsedMarker", value: "Never used", updated_at: now },
    { locale: "ru", namespace: "profile", key: "neverUsedMarker", value: "Не использовался", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "profile" })
    .whereIn("key", ["activeMarker", "neverUsedMarker"])
    .delete();
};
