// Missed in 064_translations_seed_telegram.cjs -- the profile page's
// "Connect Telegram" button (mirrors profile/connectGithub from
// 027_translations_seed_github_oauth.cjs) needs its own key. 064 is
// already deployed, so this is a separate small addition rather than an
// edit to that file.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "profile", key: "connectTelegram", value: "Connect Telegram", updated_at: now },
    { locale: "ru", namespace: "profile", key: "connectTelegram", value: "Подключить Telegram", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "profile", key: "connectTelegram" }).delete();
};
