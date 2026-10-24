const entries = {
  "issueImport": {
    "en": "Issue import",
    "ru": "Импорт issues"
  },
  "webhookEnabled": {
    "en": "Enabled",
    "ru": "Включён"
  },
  "webhookDisabled": {
    "en": "Disabled",
    "ru": "Выключен"
  },
  "webhookError": {
    "en": "Import error",
    "ru": "Ошибка импорта"
  },
  "enableWebhook": {
    "en": "Enable import",
    "ru": "Включить импорт"
  },
  "disableWebhook": {
    "en": "Disable import",
    "ru": "Выключить импорт"
  },
  "disableWebhookConfirm": {
    "en": "Disable new issue imports from this repository?",
    "ru": "Выключить импорт новых issues из этого репозитория?"
  },
  "retryWebhook": {
    "en": "Retry failed imports",
    "ru": "Повторить импорт"
  },
  "webhookDelivery_pending": {
    "en": "Queued",
    "ru": "В очереди"
  },
  "webhookDelivery_processing": {
    "en": "Importing",
    "ru": "Импортируется"
  },
  "webhookDelivery_done": {
    "en": "Imported",
    "ru": "Импортировано"
  },
  "webhookDelivery_ignored": {
    "en": "Skipped",
    "ru": "Пропущено"
  },
  "webhookDelivery_failed": {
    "en": "Failed",
    "ru": "Ошибка"
  }
};
exports.up = async function(knex) {
 const updated_at=new Date().toISOString();
 const rows=Object.entries(entries).flatMap(([key,locales])=>Object.entries(locales).map(([locale,value])=>({locale,namespace:"projects",key,value,updated_at})));
 await knex("translations").insert(rows).onConflict(["locale","namespace","key"]).merge(["value","updated_at"]);
};
exports.down = async function(knex) { await knex("translations").where({namespace:"projects"}).whereIn("key",Object.keys(entries)).del(); };
