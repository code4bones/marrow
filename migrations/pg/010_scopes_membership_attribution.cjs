// T-MEMORY-029 / D-MEMORY-007: read/write/admin scopes, project membership,
// and credential attribution for events. Two additive pieces:
//
// 1. `gateway_clients` gets `owner_user_id` (which human, if any, this
//    client credential belongs to) and `scope` (the credential's ceiling:
//    read/write/admin). Both are nullable — most `gateway_clients` rows are
//    transient anonymous sightings written by `touchClient()` on every
//    request and never need either field; only credentials that are
//    deliberately migrated/owned (starting with the static MCP_TOKEN, see
//    the startup upsert in `src/gateway.ts`) get them populated.
// 2. `project_members` (project_id, user_id) implements the membership
//    model from D-MEMORY-007: a `role=member` session sees only projects it
//    is a member of (plus common, which is never project-scoped so it is
//    never subject to this table at all). Composite PK keeps membership
//    a plain set with no per-row metadata, matching the decision's explicit
//    "no permission matrices" stance.
const scopeValues = ["read", "write", "admin"];

exports.up = async function up(knex) {
  await knex.schema.alterTable("gateway_clients", (table) => {
    table.text("owner_user_id").references("id").inTable("users").onDelete("SET NULL");
    table.text("scope");
  });
  await knex.schema.raw(
    `alter table gateway_clients add constraint gateway_clients_scope_check check (scope in (${scopeValues
      .map((value) => `'${value}'`)
      .join(", ")}))`
  );
  await knex.schema.raw("create index idx_gateway_clients_owner_user_id on gateway_clients(owner_user_id)");

  await knex.schema.createTable("project_members", (table) => {
    table.text("project_id").notNullable().references("id").inTable("projects").onDelete("CASCADE");
    table.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.primary(["project_id", "user_id"]);
  });

  await knex.schema.raw("create index idx_project_members_user_id on project_members(user_id)");
  await knex.schema.raw("create index idx_project_members_project_id on project_members(project_id)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("project_members");
  await knex.schema.raw("alter table gateway_clients drop constraint if exists gateway_clients_scope_check");
  await knex.schema.alterTable("gateway_clients", (table) => {
    table.dropColumn("scope");
    table.dropColumn("owner_user_id");
  });
};
