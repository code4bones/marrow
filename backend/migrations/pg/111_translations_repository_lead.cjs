const entries = {
  repositoryLead: { en: "Lead developer", ru: "Главный разработчик" },
  chooseRepositoryLead: { en: "Select a project member", ru: "Выберите участника проекта" },
  repositoryLeadUpdated: { en: "Lead developer updated", ru: "Главный разработчик обновлён" }
};
exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) => Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "projects", key, value, updated_at })));
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};
exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "projects" }).whereIn("key", Object.keys(entries)).del();
};
