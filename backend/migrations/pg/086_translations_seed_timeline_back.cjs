// T-context (2026-08-26, owner's ask: mobile PWA layout follow-up --
// single-column Miller drill-in, T-MEMORY-131): DrillColumn's existing
// "close this column" icon doubles as a back-one-level action on mobile
// (same onToggle handler, single visible column) -- needs its own label
// instead of reusing "closeThisColumn", which reads wrong for that role.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "decisions", key: "back", value: "Back", updated_at: now },
    { locale: "ru", namespace: "decisions", key: "back", value: "Назад", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "decisions", key: "back" }).delete();
};
