// T-MEMORY-184: durable, integration-neutral outbox. The first consumer is
// TellyMCP's generic inbox, but neither the table nor its states encode a
// Telly-specific transport. A mutation must be committed independently of an
// external integration being reachable.
const deliveryStatuses = ["pending", "sending", "delivered", "failed"];

exports.up = async function up(knex) {
  await knex.schema.createTable("integration_outbox", (table) => {
    table.uuid("id").primary();
    table.text("integration").notNullable();
    table.text("kind").notNullable();
    table.text("idempotency_key").notNullable();
    table.text("source_event_id").notNullable();
    table.text("project_id").references("id").inTable("projects").onDelete("CASCADE");
    table.text("task_id").references("id").inTable("tasks").onDelete("CASCADE");
    table.text("recipient_user_id").references("id").inTable("users").onDelete("SET NULL");
    table.text("actor_user_id").references("id").inTable("users").onDelete("SET NULL");
    table.jsonb("payload").notNullable();
    table.text("delivery_status").notNullable().defaultTo("pending");
    table.integer("attempt_count").notNullable().defaultTo(0);
    table.timestamp("available_at", { useTz: true }).notNullable();
    table.timestamp("locked_until", { useTz: true });
    table.timestamp("delivered_at", { useTz: true });
    table.text("last_error");
    table.jsonb("delivery_response");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.unique(["integration", "idempotency_key"], "integration_outbox_integration_idempotency_unique");
    table.check(
      "delivery_status in (" + deliveryStatuses.map(() => "?").join(", ") + ")",
      deliveryStatuses
    );
    table.index(["integration", "delivery_status", "available_at"], "integration_outbox_dispatch_idx");
    table.index(["task_id"], "integration_outbox_task_idx");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("integration_outbox");
};
