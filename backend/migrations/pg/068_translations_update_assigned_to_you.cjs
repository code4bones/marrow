// T-MEMORY-093 follow-up: this badge now also fires for status-change/
// completion events (not just the original assignment), so "Assigned to
// you" reads wrong on e.g. a "task completed" notification -- 062 already
// deployed, so this is an UPDATE to the existing row, not a new insert.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").where({ namespace: "notifications", key: "assignedToYou", locale: "en" }).update({ value: "For you", updated_at: now });
  await knex("translations").where({ namespace: "notifications", key: "assignedToYou", locale: "ru" }).update({ value: "Касается вас", updated_at: now });
};

exports.down = async function down(knex) {
  const now = new Date().toISOString();
  await knex("translations").where({ namespace: "notifications", key: "assignedToYou", locale: "en" }).update({ value: "Assigned to you", updated_at: now });
  await knex("translations").where({ namespace: "notifications", key: "assignedToYou", locale: "ru" }).update({ value: "Назначено вам", updated_at: now });
};
