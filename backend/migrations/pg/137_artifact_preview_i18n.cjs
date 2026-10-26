const entries = {
  downloadOriginal: { en: "Download file", ru: "Скачать файл" },
  previewLoading: { en: "Loading preview…", ru: "Загружаем файл…" },
  previewUnavailable: { en: "Could not preview this file", ru: "Не удалось показать файл" },
  retryPreview: { en: "Retry", ru: "Повторить" }
};
exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) => Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "artifacts", key, value, updated_at })));
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};
exports.down = async function down(knex) { await knex("translations").where({ namespace: "artifacts" }).whereIn("key", Object.keys(entries)).del(); };
