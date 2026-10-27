const entries = {
  overviewParticipant: { en: "Participant", ru: "Участник" },
  allParticipants: { en: "All participants", ru: "Все участники" },
  noAssignedRecords: { en: "No {{kind}} assigned to this participant", ru: "У выбранного участника нет назначений: {{kind}}" }
};
exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) => Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "projects", key, value, updated_at })));
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};
exports.down = async function down(knex) { await knex("translations").where({ namespace: "projects" }).whereIn("key", Object.keys(entries)).del(); };
