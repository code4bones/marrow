const entries = {
  gitlabSignInDescription: { en: "Connect your GitLab identity to open Marrow from GitLab Applications. This grants sign-in only, without repository access.", ru: "Привяжите аккаунт GitLab, чтобы входить в Marrow из меню Applications. Это только вход, без доступа к репозиториям." },
  gitlabConnect: { en: "Connect GitLab", ru: "Привязать GitLab" },
  gitlabNotConnected: { en: "GitLab is not connected", ru: "GitLab не привязан" },
  gitlabConnectedAs: { en: "Connected as {{username}}", ru: "Привязан аккаунт {{username}}" },
  gitlabLinked: { en: "GitLab connected", ru: "GitLab привязан" },
  gitlabUnlinked: { en: "GitLab disconnected", ru: "GitLab отвязан" },
  gitlabDisconnect: { en: "Disconnect GitLab", ru: "Отвязать GitLab" },
  gitlabUnlinkTitle: { en: "Disconnect GitLab?", ru: "Отвязать GitLab?" },
  gitlabUnlinkDescription: { en: "Sign-in from GitLab will stop working. Other sign-in methods will remain available.", ru: "Вход из GitLab перестанет работать. Другие способы входа останутся доступны." },
  gitlabUnavailable: { en: "GitLab sign-in is not configured", ru: "Вход через GitLab не настроен" },
  gitlabLoadFailed: { en: "Could not load GitLab status", ru: "Не удалось загрузить статус GitLab" },
  gitlabUnlinkFailed: { en: "Could not disconnect GitLab", ru: "Не удалось отвязать GitLab" }
};
exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) => Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "profile", key, value, updated_at })));
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};
exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "profile" }).whereIn("key", Object.keys(entries)).del();
};
