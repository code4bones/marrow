const entries = {
  statusClar: { en: "Clarification", ru: "Уточнение" },
  clarTitle: { en: "What needs clarification?", ru: "Что нужно уточнить?" },
  clarPlaceholder: { en: "Ask the question needed to continue this task", ru: "Напишите вопрос, без ответа на который нельзя продолжить задачу" },
  requestClar: { en: "Request clarification", ru: "Запросить уточнение" }
};
exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) => Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "tasks", key, value, updated_at })));
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};
exports.down = async function down(knex) { await knex("translations").where({ namespace: "tasks" }).whereIn("key", Object.keys(entries)).del(); };
