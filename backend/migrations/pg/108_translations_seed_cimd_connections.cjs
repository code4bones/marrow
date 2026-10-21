exports.up = async function up(knex) {
  const now = new Date().toISOString();
  const entries = {
    connectedAs: { en: "Connected as {{email}}", ru: "Подключено как {{email}}" },
    codexCimdLogin: {
      en: "Sign in to Marrow in the browser window that opens. Codex uses secure CIMD + PKCE; do not create or paste a token.",
      ru: "Войдите в Marrow в открывшемся окне браузера. Codex использует безопасные CIMD + PKCE; токен создавать или вставлять не нужно."
    }
  };
  const rows = Object.entries(entries).flatMap(([key, locales]) =>
    Object.entries(locales).map(([locale, value]) => ({ locale, namespace: "profile", key, value, updated_at: now }))
  );
  await knex("translations").insert(rows);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "profile" }).whereIn("key", ["connectedAs", "codexCimdLogin"]).delete();
};
