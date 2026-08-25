// T-context (2026-08-25, owner's ask: "пуш уведомления в браузере, не
// APN/GCM а человеческие"): simple in-tab Web Notification API toggle in
// Profile, same trigger scope as the existing Telegram notifications
// (events carrying target_user_ids).
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations").insert([
    { locale: "en", namespace: "profile", key: "desktopNotifications", value: "Desktop notifications", updated_at: now },
    { locale: "ru", namespace: "profile", key: "desktopNotifications", value: "Уведомления в браузере", updated_at: now },
    { locale: "en", namespace: "profile", key: "desktopNotificationsHint", value: "Get a native browser notification when something is assigned to you, while a Marrow tab is open.", updated_at: now },
    { locale: "ru", namespace: "profile", key: "desktopNotificationsHint", value: "Получать уведомление браузера, когда что-то назначено вам, пока открыта вкладка Marrow.", updated_at: now },
    { locale: "en", namespace: "profile", key: "desktopNotificationsBlockedHint", value: "Blocked in your browser settings. Allow notifications for this site to enable.", updated_at: now },
    { locale: "ru", namespace: "profile", key: "desktopNotificationsBlockedHint", value: "Заблокировано в настройках браузера. Разрешите уведомления для этого сайта, чтобы включить.", updated_at: now },
    { locale: "en", namespace: "profile", key: "desktopNotificationsUnsupported", value: "Your browser doesn't support desktop notifications.", updated_at: now },
    { locale: "ru", namespace: "profile", key: "desktopNotificationsUnsupported", value: "Ваш браузер не поддерживает уведомления.", updated_at: now },
    { locale: "en", namespace: "profile", key: "desktopNotificationsDenied", value: "Notification permission was denied.", updated_at: now },
    { locale: "ru", namespace: "profile", key: "desktopNotificationsDenied", value: "Доступ к уведомлениям запрещён.", updated_at: now },
    { locale: "en", namespace: "profile", key: "desktopNotificationsTestTitle", value: "Marrow", updated_at: now },
    { locale: "ru", namespace: "profile", key: "desktopNotificationsTestTitle", value: "Marrow", updated_at: now },
    { locale: "en", namespace: "profile", key: "desktopNotificationsTestBody", value: "You'll get a notification here when something is assigned to you.", updated_at: now },
    { locale: "ru", namespace: "profile", key: "desktopNotificationsTestBody", value: "Здесь будет появляться уведомление, когда что-то назначат вам.", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "profile" }).whereIn("key", [
    "desktopNotifications",
    "desktopNotificationsHint",
    "desktopNotificationsBlockedHint",
    "desktopNotificationsUnsupported",
    "desktopNotificationsDenied",
    "desktopNotificationsTestTitle",
    "desktopNotificationsTestBody"
  ]).delete();
};
