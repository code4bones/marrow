// T-context (2026-08-25, owner's ask: "уведомление об обновлении... как это
// и принято"): the "What's new" dialog's chrome strings (title/button) --
// the actual changelog content lives in front/src/shared/data/changelog.ts,
// written directly since it's product-facing prose, not a UI-chrome label.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "common", key: "whatsNewTitle", value: "What's new", updated_at: now },
    { locale: "ru", namespace: "common", key: "whatsNewTitle", value: "Что нового", updated_at: now },
    { locale: "en", namespace: "common", key: "whatsNewGotIt", value: "Got it", updated_at: now },
    { locale: "ru", namespace: "common", key: "whatsNewGotIt", value: "Понятно", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "common" }).whereIn("key", ["whatsNewTitle", "whatsNewGotIt"]).delete();
};
