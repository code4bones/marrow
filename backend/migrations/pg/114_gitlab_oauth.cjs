exports.up = async function up(knex) {
  await knex.schema.createTable("gitlab_identities", (table) => {
    table.text("id").primary();
    table.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("issuer").notNullable();
    table.text("subject").notNullable();
    table.text("username");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(["issuer", "subject"]);
    table.unique(["user_id", "issuer"]);
  });
  await knex.schema.alterTable("oauth_login_states", (table) => {
    table.text("provider");
    table.text("issuer");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("oauth_login_states", (table) => { table.dropColumn("issuer"); table.dropColumn("provider"); });
  await knex.schema.dropTableIfExists("gitlab_identities");
};
