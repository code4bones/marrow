// Backend-served i18n strings (T-MEMORY i18n pilot): translation rows are
// stored per-key rather than as one JSON blob per locale/namespace, so a
// future admin editing UI (not built in this pass) can update a single
// string without touching a whole bundle, and so the frontend's
// i18next-http-backend can be pointed at a plain GET /i18n/:locale/:namespace
// route that reduces these rows into a flat {key: value} object -- editing a
// translation is then a DB row update with no frontend rebuild/redeploy.
exports.up = async function up(knex) {
  await knex.schema.createTable("translations", (table) => {
    table.text("locale").notNullable(); // "en", "ru"
    table.text("namespace").notNullable(); // "nav" for the pilot surface
    table.text("key").notNullable(); // "overview", "tasks", ...
    table.text("value").notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.primary(["locale", "namespace", "key"]);
  });
  await knex.schema.raw("create index idx_translations_locale_namespace on translations(locale, namespace)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("translations");
};
