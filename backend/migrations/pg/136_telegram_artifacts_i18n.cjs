const entries = {
  botMessageReason_attachment_added: { en: "Attachment added to the existing task", ru: "Вложение добавлено к существующей задаче" },
  botAttachments: { en: "Attachments", ru: "Вложения" },
  botFileRetry: { en: "Retry download", ru: "Повторить загрузку" },
  botFileStatus_waiting: { en: "Waiting for task", ru: "Ожидает задачу" },
  botFileStatus_pending: { en: "Queued", ru: "В очереди" },
  botFileStatus_processing: { en: "Downloading", ru: "Загружается" },
  botFileStatus_done: { en: "Artifact saved", ru: "Артефакт сохранён" },
  botFileStatus_failed: { en: "Download failed", ru: "Ошибка загрузки" },
  botFileError_TELEGRAM_FILE_TOO_LARGE: { en: "Attachment exceeds the configured artifact size limit", ru: "Вложение превышает настроенный лимит размера артефакта" },
  botFileError_TELEGRAM_FILE_SOURCE_UNAVAILABLE: { en: "The task, bot or bound chat is unavailable", ru: "Задача, бот или привязанный чат недоступны" },
  botFileError_TELEGRAM_FILE_PROCESSING_FAILED: { en: "Download temporarily unavailable; Marrow will retry", ru: "Загрузка временно недоступна; Marrow повторит попытку" },
  botFileError_TELEGRAM_FILE_DOWNLOAD_FAILED: { en: "Telegram file download failed", ru: "Не удалось получить файл из Telegram" },
  botFileError_TELEGRAM_FILE_CONFLICT: { en: "An artifact with different content already uses this path", ru: "По этому пути уже есть артефакт с другим содержимым" }
};
exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) => Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "projects", key, value, updated_at })));
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};
exports.down = async function down(knex) { await knex("translations").where({ namespace: "projects" }).whereIn("key", Object.keys(entries)).del(); };
