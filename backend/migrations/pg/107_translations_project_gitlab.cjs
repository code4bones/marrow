const entries = {
  "repositories": {
    "en": "Repositories",
    "ru": "Репозитории"
  },
  "addRepository": {
    "en": "Add repository",
    "ru": "Добавить репозиторий"
  },
  "repositoryName": {
    "en": "Name",
    "ru": "Название"
  },
  "repositoryUrl": {
    "en": "Repository URL",
    "ru": "URL репозитория"
  },
  "gitlabHost": {
    "en": "GitLab server",
    "ru": "Сервер GitLab"
  },
  "noRepositories": {
    "en": "No repositories added",
    "ru": "Репозитории не добавлены"
  },
  "repositoryAdded": {
    "en": "Repository added",
    "ru": "Репозиторий добавлен"
  },
  "repositoryRemoved": {
    "en": "Repository detached",
    "ru": "Репозиторий отключён"
  },
  "removeRepositoryConfirm": {
    "en": "Detach this repository from the project?",
    "ru": "Отключить репозиторий от проекта?"
  },
  "memberAccount": {
    "en": "Member",
    "ru": "Участник"
  },
  "memberStatus": {
    "en": "Status",
    "ru": "Статус"
  },
  "memberRole": {
    "en": "Role",
    "ru": "Роль"
  },
  "memberActions": {
    "en": "Actions",
    "ru": "Действия"
  },
  "memberPending": {
    "en": "Pending approval",
    "ru": "Ожидает подтверждения"
  },
  "memberActive": {
    "en": "Active",
    "ru": "Активен"
  },
  "projectOwner": {
    "en": "Owner",
    "ru": "Владелец"
  },
  "gitlabUser": {
    "en": "GitLab user",
    "ru": "Пользователь GitLab"
  },
  "linkGitlabUser": {
    "en": "Link GitLab user",
    "ru": "Связать с GitLab"
  },
  "linkedGitlabUser": {
    "en": "Linked user",
    "ru": "Связанный пользователь"
  },
  "unlinkGitlabUser": {
    "en": "Unlink",
    "ru": "Убрать связь"
  },
  "unlinkGitlabConfirm": {
    "en": "Remove this GitLab user mapping?",
    "ru": "Убрать привязку пользователя GitLab?"
  },
  "gitlabMappingSaved": {
    "en": "GitLab user linked",
    "ru": "Пользователь GitLab привязан"
  },
  "gitlabMappingRemoved": {
    "en": "GitLab user unlinked",
    "ru": "Привязка GitLab удалена"
  },
  "addRepositoryFirst": {
    "en": "Add a GitLab repository first",
    "ru": "Сначала добавьте репозиторий GitLab"
  },
  "searchGitlabUsers": {
    "en": "Search by username or name",
    "ru": "Поиск по логину или имени"
  },
  "gitlabSearchMinLength": {
    "en": "Enter at least 2 characters",
    "ru": "Введите минимум 2 символа"
  },
  "noGitlabUsers": {
    "en": "No users found",
    "ru": "Пользователи не найдены"
  },
  "gitlabUsername": {
    "en": "Username",
    "ru": "Логин"
  },
  "gitlabName": {
    "en": "Name",
    "ru": "Имя"
  },
  "selectGitlabUser": {
    "en": "Select",
    "ru": "Выбрать"
  }
};

exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) =>
    Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "projects", key, value, updated_at: now })));
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "projects" }).whereIn("key", Object.keys(entries)).del();
};
