// Companion to 037_rename_active_status_to_current.cjs's data/schema
// rename. Renames the two decision-status i18n keys that referenced the
// old value name and updates their wording so "current" doesn't get
// reintroduced as "active" the next time someone edits this copy.
exports.up = async function up(knex) {
  const now = new Date().toISOString();

  await knex("translations")
    .where({ namespace: "decisions", key: "statusActive", locale: "en" })
    .update({ key: "statusCurrent", value: "Adopted", updated_at: now });
  await knex("translations")
    .where({ namespace: "decisions", key: "statusActive", locale: "ru" })
    .update({ key: "statusCurrent", value: "Принята", updated_at: now });

  await knex("translations")
    .where({ namespace: "decisions", key: "legendStatusActive", locale: "en" })
    .update({ key: "legendStatusCurrent", value: "Adopted — the decision now in force", updated_at: now });
  await knex("translations")
    .where({ namespace: "decisions", key: "legendStatusActive", locale: "ru" })
    .update({ key: "legendStatusCurrent", value: "Принято — решение сейчас в силе", updated_at: now });
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "decisions", key: "statusCurrent", locale: "en" })
    .update({ key: "statusActive", value: "Active" });
  await knex("translations")
    .where({ namespace: "decisions", key: "statusCurrent", locale: "ru" })
    .update({ key: "statusActive", value: "Активна" });

  await knex("translations")
    .where({ namespace: "decisions", key: "legendStatusCurrent", locale: "en" })
    .update({ key: "legendStatusActive", value: "Active — current understanding" });
  await knex("translations")
    .where({ namespace: "decisions", key: "legendStatusCurrent", locale: "ru" })
    .update({ key: "legendStatusActive", value: "Активно — текущее понимание" });
};
