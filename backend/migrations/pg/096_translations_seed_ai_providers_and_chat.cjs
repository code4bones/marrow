// i18n seed for the new "Ask Marrow" domain's UI (owner's request,
// 2026-09-14). Two dedicated namespaces (the Profile page's new "AI
// Providers" tab, and the new Ask Marrow chat page), plus one key each in
// "nav" (menu label) and "profile" (new tab label) -- same "add to the
// existing namespace, dedicated namespace per new domain" pattern as
// 094_translations_seed_environment_variables.cjs.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    nav: {
      ask: { en: "Ask Marrow", ru: "Спросить Marrow" }
    },
    profile: {
      aiProviders: { en: "AI Providers", ru: "ИИ-провайдеры" }
    },
    aiProviders: {
      title: { en: "AI Providers", ru: "ИИ-провайдеры" },
      description: {
        en: "Credentials for the AI models Ask Marrow uses to answer your questions. The default one is what Ask Marrow actually talks to.",
        ru: "Учётные данные для ИИ-моделей, которые использует Ask Marrow для ответов на ваши вопросы. Модель по умолчанию — та, с которой реально общается Ask Marrow."
      },
      provider: { en: "Provider", ru: "Провайдер" },
      label: { en: "Label", ru: "Название" },
      model: { en: "Model", ru: "Модель" },
      key: { en: "Key", ru: "Ключ" },
      default: { en: "Default", ru: "По умолчанию" },
      defaultBadge: { en: "Default", ru: "По умолчанию" },
      updated: { en: "Updated", ru: "Обновлено" },
      noneYet: { en: "No AI providers configured yet", ru: "ИИ-провайдеры пока не настроены" },
      addProvider: { en: "Add provider", ru: "Добавить провайдера" },
      editProvider: { en: "Edit provider", ru: "Редактировать провайдера" },
      save: { en: "Save", ru: "Сохранить" },
      labelRequired: { en: "Label is required", ru: "Укажите название" },
      labelPlaceholder: { en: "e.g. My DeepSeek key", ru: "например, Мой ключ DeepSeek" },
      apiKey: { en: "API key", ru: "API-ключ" },
      apiKeyRequired: { en: "API key is required", ru: "Укажите API-ключ" },
      modelPlaceholder: { en: "Pick a model", ru: "Выберите модель" },
      fetchModels: { en: "Fetch models", ru: "Загрузить модели" },
      typeKeyFirst: { en: "Type an API key first", ru: "Сначала введите API-ключ" },
      noModelsReturned: { en: "This provider returned no models", ru: "Провайдер не вернул ни одной модели" },
      useAsDefault: { en: "Use as default for Ask Marrow", ru: "Использовать по умолчанию для Ask Marrow" },
      saved: { en: "AI provider saved", ru: "ИИ-провайдер сохранён" },
      delete: { en: "Delete", ru: "Удалить" },
      removedProvider: { en: "Removed {{label}}", ru: "Провайдер «{{label}}» удалён" },
      removeProviderConfirmTitle: { en: "Delete {{label}}?", ru: "Удалить «{{label}}»?" }
    },
    ask: {
      title: { en: "Ask Marrow", ru: "Спросить Marrow" },
      subtitle: {
        en: "Talk to Marrow's own built-in assistant -- it can look up your real projects, tasks, decisions, and memory before answering.",
        ru: "Пообщайтесь со встроенным ассистентом Marrow — он может заглянуть в ваши реальные проекты, задачи, решения и память, прежде чем ответить."
      },
      emptyHint: { en: "Ask a question to get started, e.g. \"what's going on with my projects?\"", ru: "Задайте вопрос, чтобы начать, например «что там по проектам?»" },
      thinking: { en: "Thinking…", ru: "Думаю…" },
      inputPlaceholder: { en: "Ask a question…", ru: "Задайте вопрос…" },
      clearConfirmTitle: { en: "Clear this conversation?", ru: "Очистить эту переписку?" },
      clear: { en: "Clear conversation", ru: "Очистить переписку" },
      cleared: { en: "Conversation cleared", ru: "Переписка очищена" },
      goToProviderSettings: { en: "Add an AI provider in your profile", ru: "Добавьте ИИ-провайдера в профиле" }
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
  await knex("translations").where({ namespace: "nav", key: "ask" }).delete();
  await knex("translations").where({ namespace: "profile", key: "aiProviders" }).delete();
  await knex("translations").where({ namespace: "aiProviders" }).delete();
  await knex("translations").where({ namespace: "ask" }).delete();
};
