// Companion to 041_rename_decision_status_current_to_accepted.cjs's
// data/schema rename. Renames the two decision-status i18n keys that
// referenced the old value name; wording updated to say "Accepted" so the
// display label matches the raw enum value agents see over MCP.
exports.up = async function up(knex) {
  const now = new Date().toISOString();

  await knex("translations")
    .where({ namespace: "decisions", key: "statusCurrent", locale: "en" })
    .update({ key: "statusAccepted", value: "Accepted", updated_at: now });
  await knex("translations")
    .where({ namespace: "decisions", key: "statusCurrent", locale: "ru" })
    .update({ key: "statusAccepted", value: "Принята", updated_at: now });

  await knex("translations")
    .where({ namespace: "decisions", key: "legendStatusCurrent", locale: "en" })
    .update({ key: "legendStatusAccepted", value: "Accepted — the decision now in force", updated_at: now });
  await knex("translations")
    .where({ namespace: "decisions", key: "legendStatusCurrent", locale: "ru" })
    .update({ key: "legendStatusAccepted", value: "Принято — решение сейчас в силе", updated_at: now });
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "decisions", key: "statusAccepted", locale: "en" })
    .update({ key: "statusCurrent", value: "Adopted" });
  await knex("translations")
    .where({ namespace: "decisions", key: "statusAccepted", locale: "ru" })
    .update({ key: "statusCurrent", value: "Принята" });

  await knex("translations")
    .where({ namespace: "decisions", key: "legendStatusAccepted", locale: "en" })
    .update({ key: "legendStatusCurrent", value: "Adopted — the decision now in force" });
  await knex("translations")
    .where({ namespace: "decisions", key: "legendStatusAccepted", locale: "ru" })
    .update({ key: "legendStatusCurrent", value: "Принято — решение сейчас в силе" });
};
