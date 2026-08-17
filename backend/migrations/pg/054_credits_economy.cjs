// Credits economy (D-MEMORY-037): a per-user wallet + append-only ledger,
// plus the tables the v1 spend catalog needs (streaks, unlocks, wagers) and
// a non-destructive task-boost column. wallets.balance is a cache kept in
// sync with credit_transactions by the application, inside the same DB
// transaction as every ledger insert -- never written independently.
const creditReasons = [
  "signup_bonus",
  "task_completed",
  "task_reopened_penalty",
  "task_cancelled_penalty",
  "failed_attempt_penalty",
  "decision_accepted_bonus",
  "fault_fixed_bonus",
  "streak_bonus",
  "spend_priority_boost",
  "spend_cosmetic_unlock",
  "spend_streak_insurance",
  "wager_stake",
  "wager_payout",
  "wager_refund",
  "admin_adjustment"
];
const wagerStatuses = ["open", "won", "lost", "cancelled"];

exports.up = async function up(knex) {
  await knex.schema.createTable("wallets", (table) => {
    table.text("user_id").primary().references("id").inTable("users").onDelete("CASCADE");
    table.integer("balance").notNullable().defaultTo(0);
    table.timestamp("updated_at", { useTz: true }).notNullable();
  });

  await knex.schema.createTable("credit_transactions", (table) => {
    table.text("id").primary();
    table.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("project_id").references("id").inTable("projects").onDelete("SET NULL");
    table.integer("amount").notNullable();
    table.integer("balance_after").notNullable();
    table.text("reason").notNullable();
    table.text("related_type");
    table.text("related_id");
    table.text("note");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.check("reason in (" + creditReasons.map(() => "?").join(", ") + ")", creditReasons);
  });

  await knex.schema.createTable("streaks", (table) => {
    table.text("user_id").primary().references("id").inTable("users").onDelete("CASCADE");
    table.integer("current_streak").notNullable().defaultTo(0);
    table.integer("longest_streak").notNullable().defaultTo(0);
    table.date("last_credited_date");
    table.integer("insurance_banked").notNullable().defaultTo(0);
    table.timestamp("updated_at", { useTz: true }).notNullable();
  });

  await knex.schema.createTable("user_unlocks", (table) => {
    table.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("unlock_key").notNullable();
    table.timestamp("unlocked_at", { useTz: true }).notNullable();
    table.primary(["user_id", "unlock_key"]);
  });

  await knex.schema.createTable("wagers", (table) => {
    table.text("id").primary();
    table.text("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.text("task_id").notNullable().references("id").inTable("tasks").onDelete("CASCADE");
    table.integer("stake_amount").notNullable();
    table.decimal("payout_multiplier", 4, 2).notNullable().defaultTo(2.0);
    table.timestamp("deadline_at", { useTz: true }).notNullable();
    table.text("status").notNullable().defaultTo("open");
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("resolved_at", { useTz: true });
    table.check("status in (" + wagerStatuses.map(() => "?").join(", ") + ")", wagerStatuses);
  });

  await knex.schema.alterTable("tasks", (table) => {
    table.timestamp("boost_expires_at", { useTz: true });
  });

  await knex.schema.raw("create index idx_credit_transactions_user_id on credit_transactions(user_id)");
  await knex.schema.raw("create index idx_credit_transactions_created_at on credit_transactions(created_at)");
  await knex.schema.raw("create index idx_credit_transactions_reason on credit_transactions(reason)");
  await knex.schema.raw("create index idx_wagers_user_id on wagers(user_id)");
  await knex.schema.raw("create index idx_wagers_task_id on wagers(task_id)");
  await knex.schema.raw("create index idx_wagers_status on wagers(status)");
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("tasks", (table) => {
    table.dropColumn("boost_expires_at");
  });
  await knex.schema.dropTableIfExists("wagers");
  await knex.schema.dropTableIfExists("user_unlocks");
  await knex.schema.dropTableIfExists("streaks");
  await knex.schema.dropTableIfExists("credit_transactions");
  await knex.schema.dropTableIfExists("wallets");
};
