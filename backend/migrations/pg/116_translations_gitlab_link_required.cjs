const entries = {
  gitlabLinkRequiredTitle: { en: "First connect GitLab in Marrow", ru: "Сначала привяжите GitLab в Marrow" },
  gitlabLinkRequiredDescription: { en: "A GitLab account must be linked to your Marrow account before you can launch Marrow from GitLab.", ru: "Для входа из GitLab нужно сначала связать аккаунт GitLab с вашим аккаунтом Marrow." },
  gitlabLinkStepSignIn: { en: "Sign in to Marrow using Telegram, GitHub or your password.", ru: "Войдите в Marrow через Telegram, GitHub или с помощью пароля." },
  gitlabLinkStepProfile: { en: "In Profile → Account → GitLab, select Connect GitLab and confirm your account.", ru: "В профиле откройте «Аккаунт → GitLab», нажмите «Привязать GitLab» и подтвердите аккаунт." },
  gitlabLinkStepRetry: { en: "Return to GitLab and open Applications → Marrow again.", ru: "Вернитесь в GitLab и снова откройте Applications → Marrow." },
  gitlabLinkOpenProfile: { en: "Open Marrow profile", ru: "Открыть профиль Marrow" },
  gitlabLinkSignIn: { en: "Sign in to Marrow", ru: "Войти в Marrow" }
};
exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) => Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "auth", key, value, updated_at })));
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};
exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "auth" }).whereIn("key", Object.keys(entries)).del();
};
