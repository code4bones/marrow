// i18n seed for the new Environment Variables domain's UI (owner's
// request, 2026-09-14). "environmentVariables" namespace holds the shared
// EnvironmentVariablesSection component's own strings (used on both the
// Profile page's new tab and Project/Settings' new "Project Vars" tab);
// one key each added to "profile" (tab label) and "projects" (tab label +
// the settings page's now-tabbed "general" section label), rather than
// touching those migrations -- same "add to the existing namespace,
// dedicated namespace for the new domain itself" pattern as
// 088_translations_seed_skills.cjs / 089_translations_seed_skills_projects_ns.cjs.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    profile: {
      envVars: { en: "Environment Variables", ru: "Переменные окружения" }
    },
    projects: {
      projectVars: { en: "Project Vars", ru: "Переменные проекта" },
      generalSettings: { en: "General", ru: "Общие сведения" }
    },
    environmentVariables: {
      title: { en: "Environment Variables", ru: "Переменные окружения" },
      commonDescription: {
        en: "Your own common variables, private to you and visible in every project (nothing here is shared with anyone else).",
        ru: "Ваши общие переменные, приватны только для вас и доступны в любом проекте (никому другому не видны)."
      },
      projectDescription: {
        en: "Shared with every member of this project. Only the project's owner or a system admin can add, edit, or delete them.",
        ru: "Доступны всем участникам этого проекта. Добавлять, изменять и удалять их может только владелец проекта или системный администратор."
      },
      key: { en: "Key", ru: "Ключ" },
      value: { en: "Value", ru: "Значение" },
      scope: { en: "Scope", ru: "Область" },
      scopeCommon: { en: "Common", ru: "Общая" },
      scopeProject: { en: "Project", ru: "Проекта" },
      description: { en: "Description", ru: "Описание" },
      descriptionPlaceholder: { en: "What this is for (optional)", ru: "Для чего нужна (необязательно)" },
      updated: { en: "Updated", ru: "Обновлено" },
      noneYet: { en: "No variables yet", ru: "Переменных пока нет" },
      addVariable: { en: "Add variable", ru: "Добавить переменную" },
      editVariable: { en: "Edit variable", ru: "Редактировать переменную" },
      save: { en: "Save", ru: "Сохранить" },
      cancel: { en: "Cancel", ru: "Отмена" },
      keyRequired: { en: "Key is required", ru: "Укажите ключ" },
      keyPattern: { en: "Only letters, digits, and underscores", ru: "Только латинские буквы, цифры и подчёркивание" },
      valueRequired: { en: "Value is required", ru: "Укажите значение" },
      secretHint: { en: "Secret — mask the value by default when read", ru: "Секрет — по умолчанию скрывать значение при чтении" },
      saved: { en: "Variable saved", ru: "Переменная сохранена" },
      delete: { en: "Delete", ru: "Удалить" },
      removedVariable: { en: "Removed {{key}}", ru: "Переменная {{key}} удалена" },
      removeVariableConfirmTitle: { en: "Delete {{key}}?", ru: "Удалить {{key}}?" }
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
  await knex("translations").where({ namespace: "profile", key: "envVars" }).delete();
  await knex("translations").where({ namespace: "projects", key: "projectVars" }).delete();
  await knex("translations").where({ namespace: "projects", key: "generalSettings" }).delete();
  await knex("translations").where({ namespace: "environmentVariables" }).delete();
};
