const entries = {
  bots: { en: "Bots", ru: "Боты" },
  botClose: { en: "Close", ru: "Закрыть" },
  botTags: { en: "Message tags", ru: "Теги сообщений" },
  editBotTags: { en: "Edit tags", ru: "Изменить теги" },
  botTagsHelp: { en: "First filter: at least one configured hashtag must appear in the message. Then member mentions and DeepSeek decide whether to create a task. Case insensitive; # is optional when entering tags. Example: #ошибка @alex User creation is broken.", ru: "Первый фильтр: в сообщении должен присутствовать хотя бы один тег из списка. Затем проверяются упоминания участников и смысл через DeepSeek. Регистр не важен; при настройке # можно опустить. Пример: #ошибка @alex Не работает добавление пользователя." },
  botTagsRequired: { en: "Enter 1–20 tags (up to 64 letters, digits or underscores each).", ru: "Укажите от 1 до 20 тегов: до 64 букв, цифр или подчёркиваний в каждом." },
  botsOwnerOnly: { en: "Bots are managed by the project owner or an administrator.", ru: "Ботами управляет владелец проекта или администратор." },
  botsHowItWorks: { en: "Telegram → Marrow classifier → tasks", ru: "Telegram → классификатор Marrow → задачи" },
  botLastPoll: { en: "Last Telegram connection: {{time}}", ru: "Последняя связь с Telegram: {{time}}" },
  botActive: { en: "Active", ru: "Активен" },
  botInactive: { en: "Inactive", ru: "Неактивен" },
  botActivityLabel: { en: "Activity of @{{username}}", ru: "Активность @{{username}}" },
  botPolling_inactive: { en: "Stopped", ru: "Остановлен" },
  botPolling_starting: { en: "Connecting…", ru: "Подключение…" },
  botPolling_active: { en: "Connected to Telegram", ru: "На связи с Telegram" },
  botPolling_error: { en: "Connection error", ru: "Ошибка подключения" },
  botError_TELEGRAM_CONNECT_FAILED: { en: "Could not connect. Check the bot token and the server's Telegram proxy.", ru: "Не удалось подключиться. Проверьте токен бота и Telegram-прокси сервера." },
  botError_TELEGRAM_POLL_FAILED: { en: "Telegram is temporarily unreachable. Check the server's Telegram proxy; Marrow will retry automatically.", ru: "Telegram временно недоступен. Проверьте Telegram-прокси сервера; Marrow повторит подключение автоматически." },
  botError_TELEGRAM_POLL_CONFLICT: { en: "Another application is receiving this bot's updates, or a webhook is enabled. Stop the other receiver before reconnecting.", ru: "Другое приложение получает обновления этого бота либо включён webhook. Остановите другой обработчик перед подключением." },
  botError_TELEGRAM_POLL_UNAUTHORIZED: { en: "Telegram rejected the bot token. Add this bot again with its current token.", ru: "Telegram отклонил токен бота. Добавьте этого бота заново с актуальным токеном." },
  botError_TELEGRAM_POLL_RATE_LIMIT: { en: "Telegram asked Marrow to wait. Receiving will resume automatically after that interval.", ru: "Telegram попросил подождать. Получение сообщений возобновится автоматически после указанного им интервала." },
  botError_TELEGRAM_WEBHOOK_PRESENT: { en: "This bot has an active webhook. Remove it in the current application before connecting it to Marrow.", ru: "У бота включён webhook. Удалите его в текущем приложении перед подключением к Marrow." },
  botError_AI_PROVIDER_REQUIRED: { en: "The project owner must connect DeepSeek and choose a model in Profile.", ru: "Владельцу проекта нужно подключить DeepSeek и выбрать модель в профиле." },
  botError_GATEWAY_ERROR: { en: "Message classification or task creation failed. Marrow retries automatically; failed messages can be retried with the button below.", ru: "Не удалось проверить сообщение или создать задачу. Marrow повторяет обработку автоматически; сообщения с ошибками можно запустить повторно кнопкой ниже." },
  botsSetupHelp: { en: "Add dedicated bots and link each group or channel with a single-use key. Only bound chats are read. Mentions of members with linked Telegram accounts are checked by the project owner's DeepSeek: clear assignments create tasks; conversation and uncertain requests are skipped. The message text and mentioned Telegram IDs/usernames are sent to DeepSeek. In groups, make the bot an admin or disable Privacy Mode in BotFather (then re-add it); in channels, add it as an admin. Several bots and chats are supported without duplicate tasks.", ru: "Добавьте отдельных ботов и привяжите каждую группу или канал одноразовым ключом. Читаются только привязанные чаты. Упоминания участников, связавших Telegram в профиле, проверяет DeepSeek владельца проекта: явные поручения становятся задачами, общение и неясные просьбы пропускаются. В DeepSeek отправляются текст сообщения и Telegram ID/имена упомянутых участников. В группе назначьте бота администратором либо отключите Privacy Mode в BotFather и добавьте бота заново; в канале добавьте его администратором. Поддерживаются несколько ботов и чатов, без дублей задач." },
  botsDeepseekRequired: { en: "The project owner must connect DeepSeek and choose a model in Profile. Messages will wait for successful AI processing; tasks are never created without it.", ru: "Владелец проекта должен подключить DeepSeek и выбрать модель в профиле. Сообщения будут ожидать успешной проверки AI; без неё задачи не создаются." },
  addBot: { en: "Add bot", ru: "Добавить бота" },
  noBots: { en: "No bots connected", ru: "Боты ещё не подключены" },
  botEnabled: { en: "Enabled", ru: "Включён" },
  botDisabled: { en: "Disabled", ru: "Отключён" },
  enableBot: { en: "Enable", ru: "Включить" },
  disableBot: { en: "Disable", ru: "Отключить" },
  removeBotConfirm: { en: "Remove this bot and all its chat bindings? Existing tasks remain.", ru: "Удалить бота и все его привязки к чатам? Созданные задачи сохранятся." },
  linkBotChat: { en: "Link group / channel", ru: "Привязать группу / канал" },
  botChatTitle: { en: "Bound chat", ru: "Привязанный чат" },
  noBotChats: { en: "No chats bound. Generate a key and send it to the group/channel.", ru: "Чаты не привязаны. Создайте ключ и отправьте его в группу или канал." },
  unlinkBotChat: { en: "Unlink", ru: "Отвязать" },
  unlinkBotChatConfirm: { en: "Stop this bot reading this chat? Existing tasks remain.", ru: "Прекратить чтение этого чата данным ботом? Созданные задачи сохранятся." },
  botQueueStatus: { en: "Waiting / processing: {{pending}} · Failed: {{failed}}", ru: "Ожидают / обрабатываются: {{pending}} · Ошибок: {{failed}}" },
  botProcessingError: { en: "Bot setup or message processing needs attention", ru: "Ошибка настройки бота или обработки сообщения" },
  retryBotMessages: { en: "Retry failed messages", ru: "Повторить обработку сообщений с ошибками" },
  botLastMessage: { en: "Last received: {{chat}} · {{time}}", ru: "Последнее сообщение: {{chat}} · {{time}}" },
  botToken: { en: "Bot token", ru: "Токен бота" },
  botTokenHelp: { en: "Create a dedicated bot in @BotFather and paste its token. Each bot belongs to one Marrow project and may serve several bound chats. The token is encrypted and never shown again. Do not use the Marrow notification bot or a bot already running in another application.", ru: "Создайте отдельного бота через @BotFather и вставьте токен. Каждый бот относится к одному проекту Marrow и может читать несколько привязанных чатов. Токен хранится зашифрованным и не показывается повторно. Не используйте общего бота уведомлений Marrow или бота, уже работающего в другом приложении." },
  botLinkInstructions: { en: "Add @{{username}} to the group/channel, grant message access, then send the exact command below there as a message. A successful binding appears in the chat list automatically. Generate a separate key for each additional chat.", ru: "Добавьте @{{username}} в группу или канал, предоставьте доступ к сообщениям, затем отправьте туда точную команду ниже отдельным сообщением. После привязки чат автоматически появится в списке. Для каждого следующего чата создайте новый ключ." },
  botLinkExpires: { en: "Single use. Valid until {{time}} (10 minutes). Keep the key private until you send it to the intended chat.", ru: "Ключ одноразовый, действует до {{time}} (10 минут). Не передавайте его посторонним; отправьте только в нужный чат." }
};
exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) => Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "projects", key, value, updated_at })));
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};
exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "projects" }).whereIn("key", Object.keys(entries)).del();
};
