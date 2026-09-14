// "Ask Marrow" -- an embedded chat assistant a human can talk to directly
// in the web UI (owner's request, 2026-09-14), as opposed to Marrow's
// normal mode of being called BY an already-connected agent (Claude Code,
// ChatGPT, etc.). Two tables shipped together since they're both new and
// the chat table's FK depends on nothing from the credentials table.
//
// `ai_provider_credentials` -- modeled directly on `git_credentials`
// (012_git_credentials.cjs), per the owner's explicit correction to an
// earlier draft of this design: a per-user LIST of provider credential
// rows (provider + optional pinned model + encrypted key + a default
// flag), not a single settings form. `api_key_enc` is AES-256-GCM
// ciphertext (src/gateway/ai-provider-credentials.ts), under its own key
// AI_PROVIDER_ENC_KEY -- independent of GIT_CREDENTIAL_ENC_KEY/
// ENV_VAR_ENC_KEY/TOTP_ENC_KEY, same "different secret class,
// independently rotatable" reasoning as every other encrypted column in
// this codebase. No uniqueness on (owner_user_id, provider) -- same
// rotation-friendly reasoning as git_credentials (a user may briefly hold
// an old + a new key for the same provider). `claude`/`codex`/`deepseek`
// are all valid rows from day one even though only `deepseek` has a
// working src/gateway/llm-providers/ implementation at ship time --
// picking claude/codex as default and asking a question fails with a
// clear "not supported yet" error at the application layer, not a schema
// change later.
//
// `ai_chat_messages` -- one continuous conversation thread per user (not
// multi-thread/named conversations in this pass), only the user-visible
// turns (never the intermediate tool-use round-trips within one answer).
exports.up = async function up(knex) {
  await knex.schema.createTable("ai_provider_credentials", (table) => {
    table.text("id").primary();
    table.text("owner_user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("provider").notNullable();
    table.text("label").notNullable();
    table.text("model");
    table.text("api_key_enc").notNullable();
    table.boolean("is_default").notNullable().defaultTo(false);
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
  });

  await knex.schema.raw(`
    alter table ai_provider_credentials
    add constraint ai_provider_credentials_provider_check
    check (provider in ('claude', 'codex', 'deepseek'))
  `);
  await knex.schema.raw("create index idx_ai_provider_credentials_owner_user_id on ai_provider_credentials(owner_user_id)");
  await knex.schema.raw(
    "create unique index idx_ai_provider_credentials_one_default on ai_provider_credentials(owner_user_id) where is_default"
  );

  await knex.schema.createTable("ai_chat_messages", (table) => {
    table.text("id").primary();
    table.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("role").notNullable();
    table.text("content").notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable();
  });

  await knex.schema.raw(`
    alter table ai_chat_messages
    add constraint ai_chat_messages_role_check
    check (role in ('user', 'assistant'))
  `);
  await knex.schema.raw("create index idx_ai_chat_messages_user_created on ai_chat_messages(user_id, created_at)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("ai_chat_messages");
  await knex.schema.dropTableIfExists("ai_provider_credentials");
};
