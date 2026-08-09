// i18n for GitHub sign-in (login screen button) and the profile page's
// GitHub link/unlink section (D-MEMORY-... GitHub OAuth, option 2).
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    auth: {
      signInWithGithub: { en: "Sign in with GitHub", ru: "Войти через GitHub" },
      orDivider: { en: "or", ru: "или" }
    },
    profile: {
      githubConnectedAs: { en: "Connected to GitHub as {{login}}", ru: "Подключён к GitHub как {{login}}" },
      githubNotConnected: { en: "Not connected to GitHub", ru: "GitHub не подключён" },
      connectGithub: { en: "Connect GitHub", ru: "Подключить GitHub" },
      unlinkGithub: { en: "Unlink", ru: "Отвязать" },
      unlinkGithubConfirmTitle: { en: "Unlink your GitHub account?", ru: "Отвязать аккаунт GitHub?" },
      unlinkGithubDescription: { en: "You can connect it again anytime.", ru: "Вы всегда сможете подключить его снова." },
      githubLinked: { en: "GitHub account linked.", ru: "Аккаунт GitHub подключён." },
      githubUnlinked: { en: "GitHub account unlinked.", ru: "Аккаунт GitHub отвязан." },
      couldNotLoadGithubStatus: { en: "Could not load GitHub connection status.", ru: "Не удалось загрузить статус подключения GitHub." },
      couldNotUnlinkGithub: { en: "Could not unlink GitHub.", ru: "Не удалось отвязать GitHub." }
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
  const keys = [
    ["auth", "signInWithGithub"],
    ["auth", "orDivider"],
    ["profile", "githubConnectedAs"],
    ["profile", "githubNotConnected"],
    ["profile", "connectGithub"],
    ["profile", "unlinkGithub"],
    ["profile", "unlinkGithubConfirmTitle"],
    ["profile", "unlinkGithubDescription"],
    ["profile", "githubLinked"],
    ["profile", "githubUnlinked"],
    ["profile", "couldNotLoadGithubStatus"],
    ["profile", "couldNotUnlinkGithub"]
  ];
  for (const [namespace, key] of keys) {
    await knex("translations").where({ namespace, key }).delete();
  }
};
