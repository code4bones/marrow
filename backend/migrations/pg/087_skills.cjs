// T-context (2026-08-30, owner's ask, D-MEMORY-041): SKILLS domain -- a
// skill is markdown/text instructions an agent can load ("activate") mid-
// session, kept out of Artifacts so it gets its own nav/discovery surface.
// Body lives in Postgres (a `text` column), NOT on disk like
// artifacts.storage_path -- a skill body is always text, never binary, and
// small (instructions, not file attachments), so DB storage keeps FTS/
// backup/versioning simple with no downside. Scope (project_id nullable =
// common) mirrors decisions/artifacts/faults, per the owner's confirmed
// product decision -- NOT project-only like links/items. status is a
// 3-state draft/active/archived lifecycle (not artifacts' 2-state
// active/archived) -- a human pasting in a WIP skill plausibly wants to
// refine it before it's agent-visible; project.summary's availableSkills
// and skill.activate both filter to status='active' only.
// activation_count/last_activated_at back skill.activate's auditability
// (T-context in skills.mixin.ts). Bilingual FTS (simple+english+russian)
// matches migration 079's generated-tsvector pattern (T-MEMORY-034).
const skillStatuses = ["draft", "active", "archived"];

const skillsSearchExpression =
  "tsvector generated always as (" +
  "to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,'') || ' ' || coalesce(body,'') || ' ' || tags::text) || " +
  "to_tsvector('english', coalesce(name,'') || ' ' || coalesce(description,'') || ' ' || coalesce(body,'')) || " +
  "to_tsvector('russian', coalesce(name,'') || ' ' || coalesce(description,'') || ' ' || coalesce(body,''))" +
  ") stored";

exports.up = async function up(knex) {
  await knex.schema.createTable("skills", (table) => {
    table.text("id").primary();
    table.text("project_id").references("id").inTable("projects").onDelete("CASCADE");
    table.text("name").notNullable();
    table.text("description");
    table.text("body").notNullable();
    table.text("status").notNullable().defaultTo("active");
    table.jsonb("tags").notNullable().defaultTo("[]");
    table.integer("activation_count").notNullable().defaultTo(0);
    table.timestamp("last_activated_at", { useTz: true });
    table.timestamp("archived_at", { useTz: true });
    table.text("archived_by");
    table.text("archive_reason");
    table.text("created_by");
    table.text("updated_by");
    table.text("source_instance_id");
    table.integer("version").notNullable().defaultTo(1);
    table.timestamp("created_at", { useTz: true }).notNullable();
    table.timestamp("updated_at", { useTz: true }).notNullable();
    table.specificType("search_vector", skillsSearchExpression);
    table.check("status in (" + skillStatuses.map(() => "?").join(", ") + ")", skillStatuses);
  });

  // Uniqueness: a name is unique within its scope (project, or common) --
  // same coalesce(project_id,'__common__') trick artifacts' path-uniqueness
  // index uses (migration 002), applied to `name` here since skills have no
  // path concept.
  await knex.schema.raw("create unique index idx_skills_scope_name on skills (coalesce(project_id, '__common__'), lower(name))");
  await knex.schema.raw("create index idx_skills_project_id on skills(project_id)");
  await knex.schema.raw("create index idx_skills_search_vector on skills using gin(search_vector)");
  await knex.schema.raw("create index idx_skills_tags on skills using gin(tags)");
  await knex.schema.raw("create index idx_skills_created_at on skills(created_at)");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("skills");
};
