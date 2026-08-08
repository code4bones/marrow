// Additional "profile" namespace keys for the Connected summary card
// (ConnectedSummary, front/src/pages/profile/index.tsx) added after
// 020_translations_seed_rest.cjs had already shipped -- a separate
// migration rather than editing 020 in place, since that one was already
// applied on dev/prod and Postgres migrations are append-only here (see
// every prior *_seed_*.cjs for the same convention).
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    connected: { en: "Connected", ru: "Подключено" },
    notConnectedYet: { en: "Not connected yet", ru: "Пока не подключено" },
    cliConnectionName: { en: "Claude Code / Codex (CLI)", ru: "Claude Code / Codex (CLI)" },
    claudeWebConnectionName: { en: "Claude.ai (web)", ru: "Claude.ai (веб)" },
    chatgptWebConnectionName: { en: "ChatGPT (web)", ru: "ChatGPT (веб)" },
    revoke: { en: "Revoke", ru: "Отозвать" },
    revokeConfirmTitle: { en: "Revoke this connection?", ru: "Отозвать это подключение?" },
    revokeConfirmDescription: {
      en: "Deletes/regenerates the underlying credential — any new login attempt fails immediately, but an already-issued access token stays valid until it naturally expires (it isn't tracked server-side).",
      ru: "Удаляет или перегенерирует учётные данные — любая новая попытка входа сразу перестанет проходить, но уже выданный токен доступа останется рабочим до истечения срока (он не отслеживается на сервере)."
    }
  };

  const rows = [];
  for (const [key, byLocale] of Object.entries(entries)) {
    for (const [locale, value] of Object.entries(byLocale)) {
      rows.push({ locale, namespace: "profile", key, value, updated_at: now });
    }
  }

  await knex("translations").insert(rows);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "profile" }).whereIn("key", [
    "connected",
    "notConnectedYet",
    "cliConnectionName",
    "claudeWebConnectionName",
    "chatgptWebConnectionName",
    "revoke",
    "revokeConfirmTitle",
    "revokeConfirmDescription"
  ]).delete();
};
