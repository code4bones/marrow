// T-context (2026-08-26, owner's ask: mobile PWA layout, "bottom nav bar —
// [Tasks][Decisions][Mem] — на что не хватило места [...]"): the new
// BottomNav/MoreDrawer components need one label the desktop Sider never
// did -- the "..." overflow button/drawer title. tasks/decisions/memory
// already exist in the nav namespace and are reused as-is.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "nav", key: "more", value: "More", updated_at: now },
    { locale: "ru", namespace: "nav", key: "more", value: "Ещё", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "nav", key: "more" }).delete();
};
