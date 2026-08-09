// New "projects" namespace key for the owner badge shown on the project
// settings page (front/src/pages/projects/settings/index.tsx), plus a
// correction to dangerZoneDescription's wording -- it previously said
// "only a system admin can do this", which stopped being true once the
// per-project owner concept shipped (owner or admin can now delete).
// A separate migration rather than editing 020_translations_seed_rest.cjs
// in place, per this codebase's append-only migration convention.
exports.up = async function up(knex) {
  const now = new Date().toISOString();
  await knex("translations")
    .where({ namespace: "projects", key: "dangerZoneDescription" })
    .update({
      value: knex.raw(
        "case locale when 'ru' then ? when 'en' then ? end",
        [
          "Безвозвратно удаляет проект. Это не зависит от членства в проекте — сделать это может только владелец проекта или системный администратор.",
          "Hard-deletes this project. This does not depend on project membership -- only this project's owner or a system admin can do this."
        ]
      ),
      updated_at: now
    });

  await knex("translations").insert([
    { locale: "en", namespace: "projects", key: "youAreOwner", value: "You are the owner", updated_at: now },
    { locale: "ru", namespace: "projects", key: "youAreOwner", value: "Вы владелец", updated_at: now }
  ]);
};

exports.down = async function down(knex) {
  await knex("translations").where({ namespace: "projects", key: "youAreOwner" }).delete();
  const now = new Date().toISOString();
  await knex("translations")
    .where({ namespace: "projects", key: "dangerZoneDescription" })
    .update({
      value: knex.raw(
        "case locale when 'ru' then ? when 'en' then ? end",
        [
          "Безвозвратно удаляет проект. Это не зависит от членства в проекте — сделать это может только системный администратор.",
          "Hard-deletes this project. This does not depend on project membership -- only a system admin can do this."
        ]
      ),
      updated_at: now
    });
};
