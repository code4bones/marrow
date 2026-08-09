// Overrides I-MEMORY-060's "en empty next to the backronym" rule for the
// login/register card specifically: the owner reviewed it live and wants
// the EN subtitle visible there too, not just the ru one. Uses the EN
// wording I-MEMORY-059 already approved for the standalone (no-backronym)
// context, now reused here as well.
exports.up = async function up(knex) {
  await knex("translations")
    .where({ namespace: "auth", key: "tagline", locale: "en" })
    .update({ value: "People leave. Knowledge stays.", updated_at: new Date().toISOString() });
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "auth", key: "tagline", locale: "en" })
    .update({ value: "", updated_at: new Date().toISOString() });
};
