// T-context (2026-08-25, owner's ask: "у меня на профиле бэдж - 50, а 50
// чего?"): the avatar badge combines unreadCount + pendingApprovals with no
// breakdown -- added per-item counts in the dropdown (notifications item
// now shows its own share, matching approvals) plus a tooltip on the badge
// itself spelling out the split before the user even opens the menu.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "nav", key: "accountBadgeHint", value: "{{unread}} unread, {{approvals}} pending approvals", updated_at: now },
    { locale: "ru", namespace: "nav", key: "accountBadgeHint", value: "{{unread}} непрочитанных, {{approvals}} заявок на вступление", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "nav", key: "accountBadgeHint" }).delete();
};
