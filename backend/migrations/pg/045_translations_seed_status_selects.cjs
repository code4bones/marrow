// Detail drawer now lets Decisions and Memory records change status
// in-place (a dropdown, same interaction as the existing Task status
// select) -- these two namespaces had per-value status labels missing
// (decisions had them for its own timeline legend already; memory never
// did) or a "statusUpdated" success toast key (tasks had one, decisions
// and memory didn't).
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "decisions", key: "statusUpdated", value: "Status updated", updated_at: now },
    { locale: "ru", namespace: "decisions", key: "statusUpdated", value: "Статус обновлён", updated_at: now },

    { locale: "en", namespace: "memory", key: "statusUpdated", value: "Status updated", updated_at: now },
    { locale: "ru", namespace: "memory", key: "statusUpdated", value: "Статус обновлён", updated_at: now },
    { locale: "en", namespace: "memory", key: "statusCurrent", value: "Current", updated_at: now },
    { locale: "ru", namespace: "memory", key: "statusCurrent", value: "Актуально", updated_at: now },
    { locale: "en", namespace: "memory", key: "statusDraft", value: "Draft", updated_at: now },
    { locale: "ru", namespace: "memory", key: "statusDraft", value: "Черновик", updated_at: now },
    { locale: "en", namespace: "memory", key: "statusArchived", value: "Archived", updated_at: now },
    { locale: "ru", namespace: "memory", key: "statusArchived", value: "В архиве", updated_at: now },
    { locale: "en", namespace: "memory", key: "statusSuperseded", value: "Superseded", updated_at: now },
    { locale: "ru", namespace: "memory", key: "statusSuperseded", value: "Заменено", updated_at: now },
    { locale: "en", namespace: "memory", key: "statusRejected", value: "Rejected", updated_at: now },
    { locale: "ru", namespace: "memory", key: "statusRejected", value: "Отклонено", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "decisions", key: "statusUpdated" }).delete();
  await knex("translations")
    .where({ namespace: "memory" })
    .whereIn("key", ["statusUpdated", "statusCurrent", "statusDraft", "statusArchived", "statusSuperseded", "statusRejected"])
    .delete();
};
