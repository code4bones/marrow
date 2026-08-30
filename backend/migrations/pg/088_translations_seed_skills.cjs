// T-context (2026-08-30, D-MEMORY-041): i18n seed for the new Skills
// domain's UI. "skills" namespace mirrors the shape of the "artifacts"
// namespace (020_translations_seed_rest.cjs) -- closest precedent, since
// the create drawer reuses its drag-a-file-or-paste-text pattern. Also adds
// one key each to "nav" (menu label, 019) and "common" (kindSkill, 020's
// kindTask/kindDecision/etc group) rather than touching those migrations.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    nav: {
      skills: { en: "Skills", ru: "Скиллы" }
    },
    common: {
      kindSkill: { en: "Skill", ru: "Скилл" }
    },
    skills: {
      skills: { en: "Skills", ru: "Скиллы" },
      skillsCount_one: { en: "{{count}} skill", ru: "{{count}} скилл" },
      skillsCount_other: { en: "{{count}} skills", ru: "{{count}} скиллов" },
      newSkill: { en: "New Skill", ru: "Новый скилл" },
      editSkill: { en: "Edit Skill", ru: "Редактировать скилл" },
      idCol: { en: "ID", ru: "ID" },
      name: { en: "Name", ru: "Название" },
      description: { en: "Description", ru: "Описание" },
      body: { en: "Body", ru: "Содержимое" },
      status: { en: "Status", ru: "Статус" },
      scope: { en: "Scope", ru: "Область" },
      tagsCol: { en: "Tags", ru: "Теги" },
      tagsCommaSeparated: { en: "Tags (comma-separated)", ru: "Теги (через запятую)" },
      activations: { en: "Activations", ru: "Активации" },
      lastActivated: { en: "Last activated", ru: "Последняя активация" },
      updated: { en: "Updated", ru: "Обновлено" },
      save: { en: "Save", ru: "Сохранить" },
      reasonOptional: { en: "Reason (optional)", ru: "Причина (необязательно)" },
      dropFileHint: {
        en: "Drop a .md file here or click to browse — fills in the body below (text files only)",
        ru: "Перетащите .md файл сюда или нажмите, чтобы выбрать — заполнит содержимое ниже (только текстовые файлы)"
      },
      readingFile: { en: "Reading file…", ru: "Читаю файл…" },
      couldNotReadFile: { en: "Could not read {{name}}.", ru: "Не удалось прочитать {{name}}." },
      skillSaved: { en: "Skill saved", ru: "Скилл сохранён" },
      archive: { en: "Archive", ru: "Архивировать" },
      archiveConfirmTitle: { en: "Archive {{id}}?", ru: "Архивировать {{id}}?" },
      skillArchived: { en: "Skill archived", ru: "Скилл архивирован" },
      delete: { en: "Delete", ru: "Удалить" },
      deleteConfirmTitle: { en: "Delete {{id}}?", ru: "Удалить {{id}}?" },
      skillDeleted: { en: "Skill {{id}} deleted", ru: "Скилл {{id}} удалён" }
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
  await knex("translations").where({ namespace: "nav", key: "skills" }).delete();
  await knex("translations").where({ namespace: "common", key: "kindSkill" }).delete();
  await knex("translations").where({ namespace: "skills" }).delete();
};
