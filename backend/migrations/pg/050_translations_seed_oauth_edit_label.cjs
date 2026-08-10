// OAuthClientPanel's new "Edit label" affordance -- lets a user relabel a
// legacy credential (label: null, from before per-connector labeling
// existed) into a known connection name like "Claude.ai" so it shows up
// correctly in ConnectedSummary instead of sitting unrecognized in
// "Other/legacy credentials".
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "profile", key: "editLabel", value: "Edit label", updated_at: now },
    { locale: "ru", namespace: "profile", key: "editLabel", value: "Изменить название", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "profile", key: "editLabel" }).delete();
};
