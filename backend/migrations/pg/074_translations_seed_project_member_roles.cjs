// T-MEMORY-110: i18n for the Project Settings page's new Members section
// (pending-approval requests + active member role management).
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    projects: {
      members: { en: "Members", ru: "Участники" },
      pendingRequests: { en: "Pending requests", ru: "Ожидают одобрения" },
      activeMembers: { en: "Active members", ru: "Активные участники" },
      noOtherMembers: { en: "No other members yet.", ru: "Пока нет других участников." },
      chooseRole: { en: "Choose role", ru: "Выберите роль" },
      approve: { en: "Approve", ru: "Одобрить" },
      reject: { en: "Reject", ru: "Отклонить" },
      rejectMemberConfirmTitle: { en: "Reject this membership request?", ru: "Отклонить запрос на вступление?" },
      memberApproved: { en: "Member approved.", ru: "Участник одобрен." },
      memberRejected: { en: "Request rejected.", ru: "Запрос отклонён." },
      memberRoleUpdated: { en: "Role updated.", ru: "Роль обновлена." },
      rolePm: { en: "PM", ru: "PM" },
      roleDeveloper: { en: "Developer", ru: "Разработчик" },
      roleTester: { en: "Tester", ru: "Тестировщик" }
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
  const keys = [
    "members", "pendingRequests", "activeMembers", "noOtherMembers", "chooseRole",
    "approve", "reject", "rejectMemberConfirmTitle", "memberApproved", "memberRejected",
    "memberRoleUpdated", "rolePm", "roleDeveloper", "roleTester"
  ];
  await knex("translations").where({ namespace: "projects" }).whereIn("key", keys).delete();
};
