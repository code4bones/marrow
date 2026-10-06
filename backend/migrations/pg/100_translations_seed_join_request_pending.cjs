// Invite-link UI now branches on claimProjectInviteLink's pendingApproval
// flag (T-MEMORY-178 -- a first-time claim lands in pending_approval and
// isn't actually a member yet, see projects-core.mixin.ts). Adds the
// "request sent" screen copy, and fixes joiningAddsProject, which predated
// the approval gate (073_project_member_roles.cjs) and still promised
// instant access.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    auth: {
      joinRequestSent: { en: "Request sent for {{project}}", ru: "Заявка на {{project}} отправлена" },
      joinRequestSentDescription: {
        en: "The project owner needs to approve your request before you can access it. You'll see it in your project list once approved.",
        ru: "Владелец проекта должен одобрить вашу заявку, прежде чем вы получите доступ. Проект появится в вашем списке после одобрения."
      }
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

  await knex("translations")
    .where({ namespace: "auth", key: "joiningAddsProject", locale: "en" })
    .update({ value: "Joining may require the project owner's approval before you get access.", updated_at: now });
  await knex("translations")
    .where({ namespace: "auth", key: "joiningAddsProject", locale: "ru" })
    .update({ value: "Для присоединения может потребоваться одобрение владельца проекта.", updated_at: now });
};

exports.down = async function down(knex) {
  await knex("translations")
    .where({ namespace: "auth" })
    .whereIn("key", ["joinRequestSent", "joinRequestSentDescription"])
    .delete();

  const now = new Date().toISOString();
  await knex("translations")
    .where({ namespace: "auth", key: "joiningAddsProject", locale: "en" })
    .update({ value: "Joining adds this project to your Marrow account.", updated_at: now });
  await knex("translations")
    .where({ namespace: "auth", key: "joiningAddsProject", locale: "ru" })
    .update({ value: "Присоединение добавит этот проект в ваш аккаунт Marrow.", updated_at: now });
};
