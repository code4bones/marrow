const entries = {
  codexNoBrowserIntro: {
    en: "If Codex runs on a VM or server without a browser, use this command instead of the login command above:",
    ru: "Если Codex запущен на VM или сервере без браузера, используйте эту команду вместо команды входа выше:"
  },
  codexNoBrowserInstructions: {
    en: "Open the authorization link printed in the terminal in a browser on another computer or phone. Sign in to Marrow and approve access. Then copy the full callback URL from the browser address bar, including code and state, even if the localhost page fails to load. Paste that URL into the waiting terminal on the VM or server and press Enter to complete sign-in.",
    ru: "Откройте ссылку авторизации из терминала в браузере на другом компьютере или телефоне. Войдите в Marrow и подтвердите доступ. Затем скопируйте полный callback URL из адресной строки браузера, включая code и state, даже если страница localhost не открылась. Вставьте этот URL в ожидающий терминал на VM или сервере и нажмите Enter, чтобы завершить вход."
  }
};

exports.up = async function up(knex) {
  const updated_at = new Date().toISOString();
  const rows = Object.entries(entries).flatMap(([key, locales]) =>
    Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "profile", key, value, updated_at }))
  );
  await knex("translations").insert(rows).onConflict(["locale", "namespace", "key"]).merge(["value", "updated_at"]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "profile" }).whereIn("key", Object.keys(entries)).del();
};
