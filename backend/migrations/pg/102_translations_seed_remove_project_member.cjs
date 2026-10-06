// T-MEMORY-180: the Members section had approve/reject (pending) and role
// change (active), but no way to remove an already-active member.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    projects: {
      remove: { en: "Remove", ru: "Исключить" },
      removeMemberConfirmTitle: { en: "Remove this member from the project?", ru: "Исключить этого участника из проекта?" },
      memberRemoved: { en: "Member removed.", ru: "Участник исключён." }
    }
  };

  const rows = [];
  for (const [namespace, keys] of Object.entries(entries)) {
    for (const [key, byLocale] of Object.entries(keys)) {
      for (const [locale, value] of Object.entries(byLocale)) {
        rows.push({ locale, namespace, key, value, updated_at: now });
      }
    }
  }

  await knex("translations").insert(rows);
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "projects" })
    .whereIn("key", ["remove", "removeMemberConfirmTitle", "memberRemoved"])
    .delete();
};
