const entries = {
  gitlabOpenIssue: { en: "Open GitLab issue", ru: "Открыть issue в GitLab" },
  gitlabAssigneeNotApplied: { en: "GitLab created the issue but did not apply its assignee. Check the assignee's repository membership.", ru: "GitLab создал issue, но не назначил исполнителя. Проверьте его доступ к репозиторию." },
  gitlabExport: { en: "Create GitLab issue", ru: "Создать issue в GitLab" },
  gitlabRetry: { en: "Retry export", ru: "Повторить экспорт" },
  gitlabRepository: { en: "Select a repository", ru: "Выберите репозиторий" },
  gitlabPending: { en: "Creating GitLab issue…", ru: "Создаём issue в GitLab…" },
  gitlabUncertain: { en: "Checking whether GitLab created the issue. A second issue will not be created.", ru: "Проверяем, создался ли issue в GitLab. Повторный issue создаваться не будет." },
  gitlabMappingRequired: { en: "Link the assignee's GitLab account in project settings.", ru: "Привяжите GitLab-аккаунт исполнителя в настройках проекта." },
  gitlabCredentialRequired: { en: "Add a GitLab token in your profile, then retry export.", ru: "Добавьте GitLab-токен в профиле и повторите экспорт." },
  gitlabFailed: { en: "GitLab export failed. Check your GitLab token, repository access and assignee mapping.", ru: "Экспорт в GitLab не выполнен. Проверьте GitLab-токен, доступ к репозиторию и привязку исполнителя." },
  gitlabCancelled: { en: "Export cancelled because the assignment or repository changed.", ru: "Экспорт отменён: изменилось назначение или репозиторий." }
};
exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) => Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "tasks", key, value, updated_at })));
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};
exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "tasks" }).whereIn("key", Object.keys(entries)).del();
};
